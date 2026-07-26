# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Routes that exist for crawlers and agents rather than for readers.

Registered ahead of WikiDocumentRenderer in hooks.py, because a custom
page_renderer runs before frappe's StaticPage/TemplatePage (see
frappe/website/path_resolver.py) -- which is what lets this take over routes the
framework already owns.

can_render is a suffix check first and a query second, so a normal page load
pays almost nothing for this renderer sitting in front of the reader.
"""

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
	build_markdown_response,
	get_first_published_page,
)

MARKDOWN_SUFFIX = ".md"


class CrawlerRenderer(BaseRenderer):
	def can_render(self) -> bool:
		if not self.path.endswith(MARKDOWN_SUFFIX):
			return False

		# A page can legitimately be routed at something ending in ".md". Its own
		# URL stays HTML -- it is handed straight to WikiDocumentRenderer -- and
		# its markdown lives one suffix further out, at "<route>.md".
		if frappe.db.exists("Wiki Document", {"route": self.path}):
			return False

		return self._resolve_markdown(self.path[: -len(MARKDOWN_SUFFIX)])

	def _resolve_markdown(self, route: str) -> bool:
		"""Resolve a stripped route the same way the reader resolves an HTML page.

		Mirrors WikiDocumentRenderer.can_render: a published leaf wins, and a
		group / space route with no page of its own redirects to its first
		published page -- here, to that page's `.md`.
		"""
		leaf = frappe.db.get_value(
			"Wiki Document",
			{"route": route, "is_group": 0, "is_published": 1, "is_external_link": 0},
			"name",
		)
		if leaf:
			self.wiki_doc_name = leaf
			return True

		root_group = frappe.db.get_value(
			"Wiki Document", {"route": route, "is_group": 1}, "name"
		) or frappe.db.get_value("Wiki Space", {"route": route, "is_published": 1}, "root_group")

		if root_group:
			first_page = get_first_published_page(root_group)
			if first_page:
				frappe.redirect("/" + first_page["route"] + MARKDOWN_SUFFIX)

		return False

	def render(self):
		doc = frappe.get_cached_doc("Wiki Document", self.wiki_doc_name)
		# 404 rather than 403 on a restricted space, so a `.md` URL cannot be used
		# to probe for pages the reader itself would hide.
		doc.check_space_access("read")
		doc.check_published()
		return build_markdown_response(doc)
