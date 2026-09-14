from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.query_builder import Criterion
from frappe.query_builder.functions import DateFormat, Sum
from frappe.utils import add_months, date_diff, get_url, getdate
from frappe.utils.caching import redis_cache

from wiki.permissions import _is_manager, can_write_space

MAX_RANGE_DAYS = 400
TOP_LIMIT = 20
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
	return count_views(start, end, interval, tuple(routes), is_page, urlparse(get_url()).netloc)


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

	paths = [row.path for row in rows]
	# A space's own route is its landing page, so it takes the space's name.
	titles = {
		**dict(frappe.get_all("Wiki Document", {"route": ("in", paths)}, ["route", "title"], as_list=True)),
		**dict(frappe.get_all("Wiki Space", {"route": ("in", paths)}, ["route", "space_name"], as_list=True)),
	}
	return [{"path": row.path, "title": titles.get(row.path), "views": int(row.views)} for row in rows]


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
