# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WikiSettings(Document):
	def on_update(self):
		for key in frappe.cache().hgetall("wiki_sidebar").keys():
			frappe.cache().hdel("wiki_sidebar", key)

		clear_wiki_page_cache()


@frappe.whitelist()
def get_all_spaces():
	return frappe.get_all("Wiki Space", pluck="route")


@frappe.whitelist()
def clear_wiki_page_cache():
	for route in frappe.get_all("Wiki Page", pluck="route"):
		frappe.cache().hdel("website_page", route)

	return True
