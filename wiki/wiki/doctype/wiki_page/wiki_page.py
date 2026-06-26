# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt
import frappe
from frappe.website.website_generator import WebsiteGenerator


class WikiPage(WebsiteGenerator):
	def validate(self):
		frappe.throw(
			frappe._(
				"Wiki Page doctype is deprecated and will be deleted in a future release. Please migrate to Wiki Document (Version 3 structure)."
			)
		)

	def _migrate_to_wiki_document(self, parent_wiki_document=None, sort_order=None):
		existing_name = frappe.db.get_value("Wiki Document", {"route": self.route, "is_group": 0}, "name")
		if existing_name:
			wiki_document = frappe.get_doc("Wiki Document", existing_name)
		else:
			wiki_document = frappe.new_doc("Wiki Document")

		wiki_document.title = self.title
		wiki_document.content = self.content
		wiki_document.route = self.route
		wiki_document.is_group = 0
		wiki_document.is_published = self.published

		if parent_wiki_document is not None:
			wiki_document.parent_wiki_document = parent_wiki_document

		if sort_order is not None:
			wiki_document.sort_order = sort_order

		if existing_name:
			wiki_document.save(ignore_permissions=True)
		else:
			wiki_document.insert(ignore_permissions=True)

		return wiki_document
