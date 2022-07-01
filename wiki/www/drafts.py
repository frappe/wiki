import frappe
from frappe import _
from wiki.wiki.doctype.wiki_page.wiki_page import get_open_contributions
from wiki.wiki.doctype.wiki_page.wiki_page import get_open_drafts


def get_context(context):
	context.pilled_title = "My Drafts  " + get_open_drafts()
	context.no_cache = 1
	context.no_sidebar = 1
	color_map = {
		"Changes Requested": "blue",
		"Under Review": "orange",
		"Draft": "orange",
		"Rejected": "red",
		"Approved": "green",
	}

	context.contributions = []
	contributions = frappe.get_list(
		"Wiki Page Patch",
		["message", "status", "name", "wiki_page", "creation", "new"],
		order_by="modified desc",
		limit=10,
		filters=[["status", "=", "Draft"], ["owner", '=', frappe.session.user]],
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
				{
					"label": _("My Drafts ") + get_open_drafts(),
					"url": "/drafts",
				},
			]
		}
	)

	return context


@frappe.whitelist()
def get_drafts(limit):
	context = frappe._dict()
	context.no_cache = 1
	context.no_sidebar = 1
	color_map = {
		"Changes Requested": "blue",
		"Under Review": "orange",
		"Rejected": "red",
		"Draft": "orange",
		"Approved": "green",
	}

	context.contributions = []
	contributions = frappe.get_list(
		"Wiki Page Patch",
		["message", "status", "name", "wiki_page", "creation", "new"],
		order_by="modified desc",
		limit=limit,
		filters=[["status", "=", "Draft"]],
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
