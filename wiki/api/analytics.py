from collections import Counter
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.query_builder import Criterion
from frappe.query_builder.functions import Count, DateFormat
from frappe.utils import add_days, add_months, date_diff, get_url, getdate

from wiki.permissions import _is_manager, can_write_space

MAX_RANGE_DAYS = 400
MAX_HOURLY_RANGE_DAYS = 31
TOP_LIMIT = 20

# Never built from user input: the key is validated against this map.
INTERVAL_FORMATS = {
	"hourly": "%Y-%m-%d %H:00",
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
	routes, is_page = _scope_routes(space, document)

	view = frappe.qb.DocType("Web Page View")
	scope = _scope_criterion(view, routes, is_page)
	in_scope = Criterion.all([view.creation >= start, view.creation < add_days(end, 1), scope])

	total_views, unique_views = (
		frappe.qb.from_(view).select(Count("*"), Count(view.visitor_id).distinct()).where(in_scope)
	).run()[0]

	result = {
		"total_views": total_views,
		"unique_views": unique_views,
		"series": _series(view, in_scope, start, end, interval),
		"top_referrers": _top_referrers(view, in_scope),
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
	if interval == "hourly" and date_diff(end, start) > MAX_HOURLY_RANGE_DAYS:
		frappe.throw(_("Hourly interval cannot span more than {0} days").format(MAX_HOURLY_RANGE_DAYS))
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


def _scope_criterion(view, routes: list[str], is_page: bool):
	if not routes:
		return view.name.isnull()  # no spaces yet: match nothing
	if is_page:
		return view.path.isin(routes)
	return Criterion.any((view.path == route) | view.path.like(f"{escape_like(route)}/%") for route in routes)


def _series(view, in_scope, start: date, end: date, interval: str) -> list[dict]:
	bucket = DateFormat(view.creation, INTERVAL_FORMATS[interval])
	rows = (
		frappe.qb.from_(view)
		.select(bucket.as_("bucket"), Count("*"), Count(view.visitor_id).distinct())
		.where(in_scope)
		.groupby(bucket)
	).run()
	counts = {_bucket_start(key, interval): (views, unique) for key, views, unique in rows}

	# Empty buckets are filled so a chart draws zero instead of a line across the gap.
	series = []
	for moment in _bucket_starts(start, end, interval):
		views, unique = counts.get(moment, (0, 0))
		series.append({"date": moment, "views": views, "unique_views": unique})
	return series


def _bucket_start(key: str, interval: str) -> datetime:
	if interval == "weekly":
		return datetime.strptime(f"{key}-1", "%G-%V-%u")
	if interval == "hourly":
		return datetime.strptime(key, "%Y-%m-%d %H:%M")
	if interval == "monthly":
		return datetime.strptime(key, "%Y-%m")
	return datetime.strptime(key, "%Y-%m-%d")


def _bucket_starts(start: date, end: date, interval: str):
	moment = datetime.combine(start, datetime.min.time())
	if interval == "weekly":
		moment -= timedelta(days=moment.weekday())
	elif interval == "monthly":
		moment = moment.replace(day=1)

	stop = datetime.combine(add_days(end, 1), datetime.min.time())
	while moment < stop:
		yield moment
		if interval == "hourly":
			moment += timedelta(hours=1)
		elif interval == "daily":
			moment += timedelta(days=1)
		elif interval == "weekly":
			moment += timedelta(weeks=1)
		else:
			moment = add_months(moment, 1)


def _top_pages(view, in_scope) -> list[dict]:
	views = Count("*").as_("views")
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
	return [{"path": row.path, "title": titles.get(row.path), "views": row.views} for row in rows]


def _top_referrers(view, in_scope) -> list[dict]:
	rows = (
		frappe.qb.from_(view).select(view.referrer, Count("*")).where(in_scope).groupby(view.referrer)
	).run()

	# ponytail: groups by full referrer URL and parses hosts in Python, since MariaDB has no URL
	# function. Fine at docs traffic; push the host extraction into SQL if the benchmark says so.
	own_host = urlparse(get_url()).netloc
	counts = Counter()
	for referrer, views in rows:
		host = (urlparse(referrer).netloc if referrer else None) or None
		# Moving between pages of this site is navigation, not a referral.
		if host != own_host:
			counts[host] += views
	return [{"referrer": host, "views": views} for host, views in counts.most_common(TOP_LIMIT)]


def escape_like(value: str) -> str:
	return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
