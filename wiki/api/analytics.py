from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.query_builder import Criterion
from frappe.query_builder.functions import Count, DateFormat, Sum
from frappe.utils import add_months, date_diff, get_url, getdate
from frappe.utils.caching import redis_cache

from wiki.permissions import _is_manager, can_write_space

MAX_RANGE_DAYS = 400
TOP_LIMIT = 20
OVERVIEW_LIMIT = 8
OPEN_CHANGE_REQUEST_STATUSES = ("In Review", "Changes Requested", "Approved")
# The rollup job clears the cache after each run, so this only bounds how long an unused entry lives.
CACHE_SECONDS = 15 * 60

# Never built from user input: the key is validated against this map.
INTERVAL_FORMATS = {
	"daily": "%Y-%m-%d",
	# ISO year and week, turned back into the Monday that starts the week.
	"weekly": "%x-%v",
	"monthly": "%Y-%m",
}


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
	# Access is checked on every call; only the counting below is cached.
	routes, is_page = _scope_routes(space, document)
	# Referrers from the host the dashboard is served on are navigation, so the host is part of the key.
	result = count_views(start, end, interval, tuple(routes), is_page, urlparse(get_url()).netloc)
	# Outside the cache: turning tracking on must hide the notice on the next load.
	return {**result, "tracking_enabled": bool(frappe.get_website_settings("enable_view_tracking"))}


@frappe.whitelist()
def get_overview(from_date: str, to_date: str) -> dict:
	"""Wiki-wide totals, views by space and top pages, each against the window just before."""
	if not _is_manager():
		frappe.throw(_("Not permitted to view wiki analytics"), frappe.PermissionError)
	start, end = _validate_range(from_date, to_date, "daily")
	previous_end = start - timedelta(days=1)
	previous_start = previous_end - (end - start)

	current = count_views_by_path(start, end)
	previous = count_views_by_path(previous_start, previous_end)
	# Resolved outside the cache, so a renamed space shows its new name straight away.
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
		# A backlog, not traffic: it counts what is open today whatever the range, so it has no delta.
		"open_change_requests": {"value": sum(row["count"] for row in open_change_requests), "delta": None},
		"open_change_requests_by_space": open_change_requests,
		"tracking_enabled": bool(frappe.get_website_settings("enable_view_tracking")),
	}


@redis_cache(ttl=CACHE_SECONDS)
def count_views_by_path(start: date, end: date) -> dict[str, tuple[int, int]]:
	view = frappe.qb.DocType("Wiki Page View Daily")
	rows = (
		frappe.qb.from_(view)
		.select(view.path, Sum(view.views), Sum(view.new_visitors))
		.where(view.date[start:end])
		.groupby(view.path)
	).run()
	return {path: (int(views), int(new)) for path, views, new in rows if path}


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


@frappe.whitelist(methods=["POST"])
def enable_view_tracking() -> None:
	# One switch for the whole site, so it is not a space writer's to flip.
	if not _is_manager():
		frappe.throw(_("Not permitted to turn on page view tracking"), frappe.PermissionError)
	settings = frappe.get_single("Website Settings")
	settings.enable_view_tracking = 1
	settings.save(ignore_permissions=True)


@redis_cache(ttl=CACHE_SECONDS)
def count_views(
	start: date, end: date, interval: str, routes: tuple[str, ...], is_page: bool, own_host: str
) -> dict:
	# Raw Web Page View rows are never read here: counting distinct visitors over them took
	# 83s at a million rows (see the phase 4 benchmark in specs/page_view_analytics.md).
	view = frappe.qb.DocType("Wiki Page View Daily")
	in_range = view.date[start:end]
	paths = routes if is_page else _paths_under(view, routes)
	# An empty IN () is invalid SQL, and no path means nothing to count.
	in_scope = Criterion.all([in_range, view.path.isin(paths) if paths else view.name.isnull()])

	total_views, new_visitors = (
		frappe.qb.from_(view).select(Sum(view.views), Sum(view.new_visitors)).where(in_scope)
	).run()[0]

	result = {
		"total_views": int(total_views or 0),
		"new_visitors": int(new_visitors or 0),
		"series": _series(view, in_scope, start, end, interval),
		"top_referrers": _top_referrers(view, in_scope, own_host),
	}
	if not is_page:
		result["top_pages"] = _top_pages(view, in_scope)
	return result


def _validate_range(from_date: str, to_date: str, interval: str) -> tuple[date, date]:
	if interval not in INTERVAL_FORMATS:
		frappe.throw(_("Interval must be one of {0}").format(", ".join(INTERVAL_FORMATS)))

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


def _paths_under(view, routes: list[str]) -> list[str]:
	"""Logged paths that are a route or sit below one.

	Matched in Python on the few distinct paths: wiki-wide, one `path = route OR path LIKE
	'route/%'` pair per space took 570ms at only 20k rows with 288 spaces.
	"""
	route_set = set(routes)
	# No date filter: DISTINCT path alone is a loose index scan (5ms against 380ms with the range),
	# and the caller's range still applies to the counts.
	paths = frappe.qb.from_(view).select(view.path).distinct().run(pluck=True)
	return [path for path in paths if path and _has_prefix_in(path, route_set)]


def _has_prefix_in(path: str, routes: set[str]) -> bool:
	# Route prefixes end at a "/": "docs" covers "docs/intro" but not "docsx/intro".
	parts = path.split("/")
	return any("/".join(parts[:depth]) in routes for depth in range(1, len(parts) + 1))


def _series(view, in_scope, start: date, end: date, interval: str) -> list[dict]:
	bucket = DateFormat(view.date, INTERVAL_FORMATS[interval])
	rows = (
		frappe.qb.from_(view)
		.select(bucket.as_("bucket"), Sum(view.views), Sum(view.new_visitors))
		.where(in_scope)
		.groupby(bucket)
	).run()
	counts = {_bucket_start(key, interval): (int(views), int(new)) for key, views, new in rows}

	# Empty buckets are filled so a chart draws zero instead of a line across the gap.
	series = []
	for day in _bucket_starts(start, end, interval):
		views, new = counts.get(day, (0, 0))
		series.append({"date": day, "views": views, "new_visitors": new})
	return series


def _bucket_start(key: str, interval: str) -> date:
	if interval == "weekly":
		return datetime.strptime(f"{key}-1", "%G-%V-%u").date()
	if interval == "monthly":
		return datetime.strptime(key, "%Y-%m").date()
	return datetime.strptime(key, "%Y-%m-%d").date()


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


def _top_pages(view, in_scope) -> list[dict]:
	views = Sum(view.views).as_("views")
	rows = (
		frappe.qb.from_(view)
		.select(view.path, views)
		.where(in_scope)
		.groupby(view.path)
		.orderby(views, order=frappe.qb.desc)
		.limit(TOP_LIMIT)
	).run(as_dict=True)

	titles = _page_titles([row.path for row in rows])
	top_pages = []
	for row in rows:
		document, title = titles.get(row.path, (None, None))
		top_pages.append({"path": row.path, "document": document, "title": title, "views": int(row.views)})
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


def _top_referrers(view, in_scope, own_host: str) -> list[dict]:
	views = Sum(view.views).as_("views")
	rows = (
		frappe.qb.from_(view)
		.select(view.referrer_host, views)
		# Moving between pages of this site is navigation, not a referral.
		.where(in_scope & (view.referrer_host != own_host))
		.groupby(view.referrer_host)
		.orderby(views, order=frappe.qb.desc)
		.limit(TOP_LIMIT)
	).run()
	return [{"referrer": host or None, "views": int(views)} for host, views in rows]
