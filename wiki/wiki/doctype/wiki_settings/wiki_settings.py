# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WikiSettings(Document):
	def on_update(self):
		doc_before_save = self.get_doc_before_save()
		if doc_before_save and self.hide_sidebar_items != doc_before_save.hide_sidebar_items:
			for key in frappe.cache().hgetall("wiki_sidebar").keys():
				frappe.cache().hdel("wiki_sidebar", key)


@frappe.whitelist()
def get_all_spaces():
	return frappe.get_all("Wiki Space", pluck="route")
