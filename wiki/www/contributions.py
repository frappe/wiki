import frappe
from wiki.wiki.doctype.wiki_page.wiki_page import get_open_contributions


def get_context(context):
	context.pilled_title = "My Contributions  " + get_open_contributions()
	context.no_cache = 1
	context.no_sidebar = 1
	color_map = {
		"Changes Requested": "blue",
		"Under Review": "orange",
		"Rejected": "red",
		"Approved": "green",
	}

	context.contributions = []
	contributions = frappe.get_list(
		"Wiki Page Patch",
		["message", "status", "name", "wiki_page", "creation", "new"],
		order_by="modified desc",
		limit=10,
		filters=[["status", "!=", "Approved"]],
	)
	for contribution in contributions:
		route = frappe.db.get_value("Wiki Page", contribution.wiki_page, "route")
		if contribution.new:
			contribution.edit_link = f"/{route}/new?wiki_page_patch={contribution.name}"
		else:
			contribution.edit_link = f"/{route}/edit?wiki_page_patch={contribution.name}"
		contribution.color = color_map[contribution.status]
		contribution.creation = frappe.utils.pretty_date(contribution.creation)
		context.contributions.extend([contribution])

	context = context.update(
		{
			"post_login": [
				{"label": _("My Account"), "url": "/me"},
				{"label": _("Logout"), "url": "/?cmd=web_logout"},
				{
					"label": _("My Contributions ") + get_open_contributions(),
					"url": "/contributions",
				},
			]
		}
	)

	return context


@frappe.whitelist()
def get_contributions(limit):
	context = frappe._dict()
	context.no_cache = 1
	context.no_sidebar = 1
	color_map = {
		"Changes Requested": "blue",
		"Under Review": "orange",
		"Rejected": "red",
		"Approved": "green",
	}

	context.contributions = []
	contributions = frappe.get_list(
		"Wiki Page Patch",
		["message", "status", "name", "wiki_page", "creation", "new"],
		order_by="modified desc",
		limit=limit,
		filters=[["status", "!=", "Approved"]],
	)
	for contribution in contributions:
		route = frappe.db.get_value("Wiki Page", contribution.wiki_page, "route")
		if contribution.new:
			contribution.edit_link = f"/{route}/new?wiki_page_patch={contribution.name}"
		else:
			contribution.edit_link = f"/{route}/edit?wiki_page_patch={contribution.name}"
		contribution.color = color_map[contribution.status]
		contribution.creation = frappe.utils.pretty_date(contribution.creation)
		context.contributions.extend([contribution])
	return context
