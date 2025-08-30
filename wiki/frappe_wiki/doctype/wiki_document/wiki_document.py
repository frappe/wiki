# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.nestedset import NestedSet
from frappe.website.page_renderers.base_renderer import BaseRenderer


class WikiDocument(NestedSet):
	def validate(self):
		self.set_route()

	def set_route(self):
		if self.is_published and not self.route:
			self.route = frappe.website.utils.cleanup_page_name(self.title).replace("_", "-")


class WikiDocumentRenderer(BaseRenderer):
	def can_render(self) -> bool:
		document_name = frappe.db.get_value("Wiki Document", {"route": self.path, "is_published": 1}, "name")
		if document_name:
			self.wiki_doc_name = document_name
			return True

		return False

	def render(self):
		doc = frappe.get_cached_doc("Wiki Document", self.wiki_doc_name)
		content_html = frappe.utils.md_to_html(doc.content)
		html = frappe.render_template(
			"templates/wiki/document.html",
			{
				"doc": doc,
				"rendered_content": content_html,
			},
		)
		return self.build_response(html)
