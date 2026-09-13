import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import add_days, date_diff, getdate

from wiki.permissions import can_write_space

MAX_RANGE_DAYS = 400


@frappe.whitelist()
def get_analytics(space: str, from_date: str, to_date: str) -> dict:
	"""Page view numbers for a Wiki Space over an inclusive date range."""
	space_doc = frappe.get_cached_doc("Wiki Space", space)
	# Traffic is for the people who run the space, not everyone who reads it.
	if not can_write_space(space_doc):
		frappe.throw(_("Not permitted to view analytics for this space"), frappe.PermissionError)

	start, end = getdate(from_date), getdate(to_date)
	if end < start:
		frappe.throw(_("From Date must be on or before To Date"))
	# A mandatory, bounded range keeps every request off a full table scan.
	if date_diff(end, start) > MAX_RANGE_DAYS:
		frappe.throw(_("Date range cannot be longer than {0} days").format(MAX_RANGE_DAYS))

	view = frappe.qb.DocType("Web Page View")
	route = space_doc.route
	total_views = (
		frappe.qb.from_(view)
		.select(Count("*"))
		.where(view.creation >= start)
		.where(view.creation < add_days(end, 1))
		.where((view.path == route) | view.path.like(f"{escape_like(route)}/%"))
	).run()[0][0]

	return {"total_views": total_views}


def escape_like(value: str) -> str:
	return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
