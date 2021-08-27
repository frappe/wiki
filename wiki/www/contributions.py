import frappe


def get_context(context):
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
