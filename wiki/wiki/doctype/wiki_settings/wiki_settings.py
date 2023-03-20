# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document


class WikiSettings(Document):
	pass


@frappe.whitelist()
def update_sidebar(sidebar_items):
	sidebars = json.loads(sidebar_items)

	sidebar_items = sidebars.items()
	if sidebar_items:
		idx = 0
		for sidebar, items in sidebar_items:
			for item in items:
				idx += 1
				frappe.db.set_value(
					"Wiki Sidebar", {"wiki_page": item["name"]}, {"parent_label": sidebar, "idx": idx}
				)
