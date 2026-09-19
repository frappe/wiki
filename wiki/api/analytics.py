from datetime import date, timedelta
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import add_months, date_diff, get_url, getdate

from wiki import analytics_store as store
from wiki.permissions import _is_manager, can_write_space

MAX_RANGE_DAYS = 400
TOP_LIMIT = 20
OVERVIEW_LIMIT = 5
OPEN_CHANGE_REQUEST_STATUSES = ("In Review", "Changes Requested", "Approved")


@frappe.whitelist()
def get_analytics(
	from_date: str,
	to_date: str,
	interval: str = "daily",
	space: str | None = None,
	document: str | None = None,
) -> dict:
	"""Page view numbers over an inclusive date range, wiki-wide or for one space or page."""
	start, end = _validate_range(from_date, to_date, interval)
	routes, is_page = _scope_routes(space, document)
	result = count_views(start, end, interval, tuple(routes), is_page, urlparse(get_url()).netloc)
	return {**result, "tracking_enabled": bool(frappe.get_website_settings("enable_view_tracking"))}


@frappe.whitelist()
def get_overview(from_date: str, to_date: str) -> dict:
	"""Wiki-wide totals, views by space, top pages and referrers, each against the window just before."""
	if not _is_manager():
		frappe.throw(_("Not permitted to view wiki analytics"), frappe.PermissionError)
	start, end = _validate_range(from_date, to_date, "daily")
	previous_end = start - timedelta(days=1)
	previous_start = previous_end - (end - start)

	current = store.views_by_path(start, end)
	previous = store.views_by_path(previous_start, previous_end)
	spaces = frappe.get_all(
		"Wiki Space",
		filters={"route": ("is", "set")},
		fields=["name", "space_name", "route", "space_icon", "space_color", "avatar", "app_switcher_logo"],
	)
	space_of = _space_resolver(spaces)
	open_change_requests = _open_change_requests_by_space()
	current = {path: counts for path, counts in current.items() if space_of(path)}
	previous = {path: counts for path, counts in previous.items() if space_of(path)}

	return {
		"views": _metric(current, previous, 0),
		"new_visitors": _metric(current, previous, 1),
		"spaces": _views_by_space(spaces, space_of, current, previous),
		"top_pages": _top_pages_with_delta(space_of, current, previous),
		"top_referrers": _top_referrers_with_delta(
			(start, end, tuple(current)), (previous_start, previous_end, tuple(previous))
		),
		# A backlog, not traffic: it counts what is open today whatever the range, so it has no delta.
		"open_change_requests": {"value": sum(row["count"] for row in open_change_requests), "delta": None},
		"open_change_requests_by_space": open_change_requests,
		"tracking_enabled": bool(frappe.get_website_settings("enable_view_tracking")),
	}


def _space_resolver(spaces: list[dict]):
	by_route = {space.route: space for space in spaces}

	def space_of(path: str) -> dict | None:
		# Longest route first: a space at "docs/v2" owns "docs/v2/intro" over a space at "docs".
		parts = path.split("/")
		for depth in range(len(parts), 0, -1):
			if space := by_route.get("/".join(parts[:depth])):
				return space
		return None

	return space_of


def _delta(current: int, previous: int) -> float | None:
	# Growth from nothing has no percentage, and +100% would be a made-up one.
	if not previous:
		return None
	return round((current - previous) * 100 / previous, 1)


def _metric(current: dict, previous: dict, index: int) -> dict:
	value = sum(counts[index] for counts in current.values())
	before = sum(counts[index] for counts in previous.values())
	return {"value": value, "delta": _delta(value, before)}


def _views_by_space(spaces, space_of, current: dict, previous: dict) -> list[dict]:
	now, before = {}, {}
	for totals, counts in ((now, current), (before, previous)):
		for path, (views, _new) in counts.items():
			name = space_of(path).name
			totals[name] = totals.get(name, 0) + views

	rows = [
		{
			**space,
			"views": now.get(space.name, 0),
			"delta": _delta(now.get(space.name, 0), before.get(space.name, 0)),
		}
		for space in spaces
		if space.name in now or space.name in before
	]
	rows.sort(key=lambda row: row["views"], reverse=True)
	return rows[:OVERVIEW_LIMIT]


def _top_pages_with_delta(space_of, current: dict, previous: dict) -> list[dict]:
	paths = sorted(current, key=lambda path: current[path][0], reverse=True)[:OVERVIEW_LIMIT]
	titles = _page_titles(paths)
	return [
		{
			"path": path,
			"document": titles.get(path, (None, None))[0],
			"title": titles.get(path, (None, None))[1],
			"space": space_of(path).name,
			"space_name": space_of(path).space_name,
			"views": current[path][0],
			"delta": _delta(current[path][0], previous.get(path, (0, 0))[0]),
		}
		for path in paths
	]


def _top_referrers_with_delta(current_window: tuple, previous_window: tuple) -> list[dict]:
	own_host = urlparse(get_url()).netloc
	current = store.views_by_referrer(*current_window, own_host)
	previous = store.views_by_referrer(*previous_window, own_host)
	hosts = sorted(current, key=lambda host: (-current[host], host))[:OVERVIEW_LIMIT]
	return [
		{
			"referrer": host or None,
			"views": current[host],
			"delta": _delta(current[host], previous.get(host, 0)),
		}
		for host in hosts
	]


def _open_change_requests_by_space() -> list[dict]:
	"""Change requests waiting on a decision right now, per space, largest first."""
	cr = frappe.qb.DocType("Wiki Change Request")
	space = frappe.qb.DocType("Wiki Space")
	count = Count(cr.name).as_("count")
	return (
		frappe.qb.from_(cr)
		.left_join(space)
		.on(space.name == cr.wiki_space)
		.select(cr.wiki_space.as_("space"), space.space_name, count)
		# Editing a page opens a Draft on its own, so a Draft is an edit, not a request.
		.where(cr.status.isin(OPEN_CHANGE_REQUEST_STATUSES))
		.groupby(cr.wiki_space, space.space_name)
		.orderby(count, order=frappe.qb.desc)
	).run(as_dict=True)


@frappe.whitelist()
def get_view_tracking() -> bool:
	if not _is_manager():
		frappe.throw(_("Not permitted to read the page view tracking setting"), frappe.PermissionError)
	return bool(frappe.get_website_settings("enable_view_tracking"))


@frappe.whitelist(methods=["POST"])
def set_view_tracking(enabled: bool = True) -> None:
	# One switch for the whole site, so it is not a space writer's to flip.
	if not _is_manager():
		frappe.throw(_("Not permitted to change page view tracking"), frappe.PermissionError)
	settings = frappe.get_single("Website Settings")
	settings.enable_view_tracking = int(enabled)
	settings.save(ignore_permissions=True)


def count_views(
	start: date, end: date, interval: str, routes: tuple[str, ...], is_page: bool, own_host: str
) -> dict:
	paths = tuple(routes) if is_page else tuple(_paths_under(routes))
	total_views, new_visitors = store.totals(start, end, paths)

	result = {
		"total_views": total_views,
		"new_visitors": new_visitors,
		"series": _series(start, end, paths, interval),
		"top_referrers": _top_referrers(start, end, paths, own_host),
	}
	if not is_page:
		result["top_pages"] = _top_pages(start, end, paths)
	return result


def _validate_range(from_date: str, to_date: str, interval: str) -> tuple[date, date]:
	if interval not in store.INTERVALS:
		frappe.throw(_("Interval must be one of {0}").format(", ".join(store.INTERVALS)))

	start, end = getdate(from_date), getdate(to_date)
	if end < start:
		frappe.throw(_("From Date must be on or before To Date"))
	# A mandatory, bounded range keeps every request off a full table scan.
	if date_diff(end, start) > MAX_RANGE_DAYS:
		frappe.throw(_("Date range cannot be longer than {0} days").format(MAX_RANGE_DAYS))
	return start, end


def _scope_routes(space: str | None, document: str | None) -> tuple[list[str], bool]:
	"""Routes to count and whether they are exact page paths, after checking access."""
	if space and document:
		frappe.throw(_("Pass either a space or a document, not both"))

	if document:
		doc = frappe.get_cached_doc("Wiki Document", document)
		page_space = doc.get_wiki_space()
		_check_space_access(page_space and page_space.name)
		return [doc.route], True

	if space:
		space_doc = frappe.get_cached_doc("Wiki Space", space)
		_check_space_access(space_doc)
		return [space_doc.route], False

	if not _is_manager():
		frappe.throw(_("Not permitted to view wiki analytics"), frappe.PermissionError)
	return frappe.get_all("Wiki Space", filters={"route": ("is", "set")}, pluck="route"), False


def _check_space_access(space) -> None:
	# Traffic is for the people who run the space, not everyone who reads it.
	if not space or not can_write_space(space):
		frappe.throw(_("Not permitted to view analytics for this space"), frappe.PermissionError)


def _paths_under(routes: tuple[str, ...]) -> list[str]:
	"""Logged paths whose own space is one of these routes.

	Matched in Python on the few distinct paths: one `path = route OR path LIKE 'route/%'`
	pair per space is 576 conditions on a 288 space wiki, checked against every row.
	"""
	# A nested space has its own writers, so its paths belong to it and not to the space around it.
	space_of = _space_resolver(
		frappe.get_all("Wiki Space", filters={"route": ("is", "set")}, fields=["route"])
	)
	route_set = set(routes)
	return [path for path in store.known_paths() if (space := space_of(path)) and space.route in route_set]


def _series(start: date, end: date, paths: tuple[str, ...], interval: str) -> list[dict]:
	counts = store.series(start, end, paths, interval)
	# Empty buckets are filled so a chart draws zero instead of a line across the gap.
	series = []
	for day in _bucket_starts(start, end, interval):
		views, new = counts.get(day, (0, 0))
		series.append({"date": day, "views": views, "new_visitors": new})
	return series


def _bucket_starts(start: date, end: date, interval: str):
	day = start
	if interval == "weekly":
		day -= timedelta(days=day.weekday())
	elif interval == "monthly":
		day = day.replace(day=1)

	while day <= end:
		yield day
		if interval == "daily":
			day += timedelta(days=1)
		elif interval == "weekly":
			day += timedelta(weeks=1)
		else:
			day = getdate(add_months(day, 1))


def _top_pages(start: date, end: date, paths: tuple[str, ...]) -> list[dict]:
	rows = store.top_paths(start, end, paths, TOP_LIMIT)
	titles = _page_titles([path for path, _views in rows])
	top_pages = []
	for path, views in rows:
		document, title = titles.get(path, (None, None))
		top_pages.append({"path": path, "document": document, "title": title, "views": views})
	return top_pages


def _page_titles(paths: list[str]) -> dict[str, tuple[str | None, str]]:
	if not paths:
		return {}
	documents = {
		route: (name, title)
		for route, name, title in frappe.get_all(
			"Wiki Document", {"route": ("in", paths)}, ["route", "name", "title"], as_list=True
		)
	}
	# A space's own route is its landing page, so it takes the space's name and has no document.
	documents.update(
		(route, (None, space_name))
		for route, space_name in frappe.get_all(
			"Wiki Space", {"route": ("in", paths)}, ["route", "space_name"], as_list=True
		)
	)
	return documents


def _top_referrers(start: date, end: date, paths: tuple[str, ...], own_host: str) -> list[dict]:
	# Moving between pages of this site is navigation, not a referral, so own_host is dropped.
	rows = store.top_referrers(start, end, paths, own_host, TOP_LIMIT)
	return [{"referrer": host or None, "views": views} for host, views in rows]
