# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document


class WikiSidebar(Document):
	def validate(self):
		self.clear_cache()

	def on_update(self):
		self.clear_cache()

	def clear_cache(self):
		topmost = "wiki"
		frappe.cache().hdel("wiki_sidebar", topmost)

	# legacy method only for patch and won't work otherwise
	def get_children(self):
		out = self.get_sidebar_items()

		for idx, sidebar_item in enumerate(self.sidebar_items):
			if sidebar_item.type == "Wiki Sidebar":
				sidebar = frappe.get_doc("Wiki Sidebar", sidebar_item.item)
				children = sidebar.get_children()
				out[idx] = {
					"group_title": sidebar_item.title,
					"group_items": children,
					"name": sidebar_item.name,
					"group_name": sidebar.name,
					"type": sidebar_item.type,
					"item": f"/{sidebar.route}",
				}

		return out

	# legacy method only for patch and won't work otherwise
	def get_sidebar_items(self):
		items_without_group = []
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={"parent": self.name},
			fields=["title", "item", "name", "type", "route"],
			order_by="idx asc",
		)

		for item in items:
			item.item = "/" + str(item.route)
			items_without_group.append(item)

		return items_without_group
