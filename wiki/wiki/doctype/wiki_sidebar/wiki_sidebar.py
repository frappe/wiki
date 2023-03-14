# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document


class WikiSidebar(Document):
	# def get_items(self):
	# 	topmost = "wiki"

	# 	sidebar_html = frappe.cache().hget("wiki_sidebar", topmost)
	# 	if not sidebar_html or frappe.conf.disable_website_cache or frappe.conf.developer_mode:
	# 		context = frappe._dict({})
	# 		context.docs_search_scope = topmost
	# 		sidebar_html = frappe.render_template(
	# 			"wiki/wiki/doctype/wiki_page/templates/web_sidebar.html", context
	# 		)
	# 		frappe.cache().hset("wiki_sidebar", topmost, sidebar_html)

	# 	return sidebar_html, topmost

	def validate(self):
		self.clear_cache()

	def on_update(self):
		self.clear_cache()

	def clear_cache(self):
		topmost = "wiki"
		frappe.cache().hdel("wiki_sidebar", topmost)
