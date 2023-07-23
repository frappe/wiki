import frappe
from frappe import _
from frappe.utils.data import cint

from wiki.wiki.doctype.wiki_page.wiki_page import get_open_drafts

color_map = {
	"Changes Requested": "blue",
	"Under Review": "orange",
	"Rejected": "red",
	"Approved": "green",
}


def get_context(context):
	context.pilled_title = "My Contributions"
	context.no_cache = 1
	context.no_sidebar = 1
	context.contributions = get_user_contributions(0, 10)
	context = context.update(
		{
			"post_login": [
				{"label": _("My Account"), "url": "/me"},
				{"label": _("Logout"), "url": "/?cmd=web_logout"},
				{
					"label": _("My Drafts ") + get_open_drafts(),
					"url": "/drafts",
				},
			]
		}
	)

	return context


@frappe.whitelist()
def get_contributions(start, limit):
	return {"contributions": get_user_contributions(start, limit)}


def get_user_contributions(start, limit):
	contributions = []
	wiki_page_patches = frappe.get_list(
		"Wiki Page Patch",
		["message", "status", "name", "wiki_page", "modified", "new"],
		order_by="modified desc",
		start=cint(start),
		limit=cint(limit),
		filters=[["status", "!=", "Draft"], ["owner", "=", frappe.session.user]],
	)
	for wiki_page_patch in wiki_page_patches:
		route = frappe.db.get_value("Wiki Page", wiki_page_patch.wiki_page, "route")
		wiki_page_patch.edit_link = f"/{route}?editWiki=1&wikiPagePatch={wiki_page_patch.name}"
		wiki_page_patch.color = color_map[wiki_page_patch.status]
		wiki_page_patch.modified = frappe.utils.pretty_date(wiki_page_patch.modified)
		contributions.extend([wiki_page_patch])

	return contributions
