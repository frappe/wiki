
import frappe
from frappe.core.page.background_jobs.background_jobs import get_info

def get_context(context):
	context.no_cache = 1
	context.no_sidebar = 1
	color_map = {
		'Changes Requested': 'blue',
		'Under Review': 'orange',
		'Rejected': 'red',
		'Approved': 'green',
	}

	context.contributions = []
	contributions = frappe.get_list("Wiki Page Patch", ["message", "status", "name", "wiki_page", 'creation', 'new'])
	for contribution in contributions:
		route = frappe.db.get_value("Wiki Page", contribution.wiki_page, "route")
		contribution.edit_link = '/edit?wiki_page='+ route + '&' + "edit=true&wiki_page_patch=" + contribution.name
		if contribution.new:
			contribution.edit_link = contribution.edit_link + '&new=1'
		contribution.color = color_map[contribution.status]
		contribution.creation = frappe.utils.pretty_date(contribution.creation)
		context.contributions.extend([contribution])
	return context