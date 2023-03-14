# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document


class WikiSidebar(Document):
	def get_items(self):
		topmost = self.find_topmost(self.name)

		sidebar_html = frappe.cache().hget("wiki_sidebar", topmost)
		if not sidebar_html or frappe.conf.disable_website_cache or frappe.conf.developer_mode:
			sidebar_items = frappe.get_doc("Wiki Sidebar", topmost).get_children()
			context = frappe._dict({})
			context.sidebar_items = sidebar_items
			context.docs_search_scope = topmost
			sidebar_html = frappe.render_template(
				"wiki/wiki/doctype/wiki_page/templates/web_sidebar.html", context
			)
			frappe.cache().hset("wiki_sidebar", topmost, sidebar_html)

		return sidebar_html, topmost

	def validate(self):
		self.clear_cache()

	def on_update(self):
		self.clear_cache()

	def find_topmost(self, me):
		parent = frappe.db.get_value("Wiki Sidebar Item", {"item": me, "type": "Wiki Sidebar"}, "parent")
		if not parent:
			return me
		return self.find_topmost(parent)

	def clear_cache(self):
		topmost = self.find_topmost(self.name)
		frappe.cache().hdel("wiki_sidebar", topmost)
