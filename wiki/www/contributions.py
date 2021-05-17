
import frappe
from frappe.core.page.background_jobs.background_jobs import get_info

def get_context(context):

	color_map = {
		'Changes Requested': 'blue',
		'Under Review': 'pink',
		'Rejected': 'red',
		'Approved': 'green',
	}

	context.contributions = []
	contributions = frappe.get_list("Wiki Page Patch", ["message", "status", "name", "wiki_page"])
	for contribution in contributions:
		route = frappe.db.get_value("Wiki Page", contribution.wiki_page, "route")
		contribution.edit_link = route+'?' + "edit=true&wiki_page_patch=" + contribution.name
		contribution.color = color_map[contribution.status]
		context.contributions.extend([contribution])
	print(contribution)
	return context