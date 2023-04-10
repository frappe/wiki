# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document


class WikiSettings(Document):
	def on_update(self):
		# change the route of wiki page for search scope
		for wiki_page in frappe.get_all("Wiki Page", fields=["name", "route"]):
			if self.wiki_search_scope == wiki_page.route.split("/", 1)[0]:
				break
			prepend_string = f"{self.wiki_search_scope}/" if self.wiki_search_scope else ""
			frappe.db.set_value(
				"Wiki Page",
				wiki_page["name"],
				{"route": f"{prepend_string}{wiki_page['route'].split('/', 1)[-1]}"},
			)


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
					"Wiki Group Item", {"wiki_page": item["name"]}, {"parent_label": sidebar, "idx": idx}
				)

	for key in frappe.cache().hgetall("wiki_sidebar").keys():
		frappe.cache().hdel("wiki_sidebar", key)
