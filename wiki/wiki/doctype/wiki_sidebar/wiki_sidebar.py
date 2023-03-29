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
