# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Routes that exist for crawlers and agents rather than for readers.

Registered ahead of WikiDocumentRenderer in hooks.py, because a custom
page_renderer runs before frappe's StaticPage/TemplatePage (see
frappe/website/path_resolver.py) -- which is what lets this take over routes the
framework already owns.

can_render is a suffix check first and a query second, so a normal page load
pays almost nothing for this renderer sitting in front of the reader.

Index routes (llms.txt) are always built as Guest, whoever asks for them. They
are crawler artefacts: a session-dependent body would be uncacheable, and one
built with an editor's visibility would publish routes the crawler must not see.
Page markdown is the opposite -- it follows the page's own permissions, exactly
like the HTML page does.
"""

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
	build_markdown_response,
	get_first_published_page,
)
from wiki.permissions import can_read_space

MARKDOWN_SUFFIX = ".md"
LLMS_TXT = "llms.txt"

# Guest-only, published content with no per-user variation, so a shared cache
# can hold it. Short enough that a newly published page shows up within the hour.
INDEX_CACHE_CONTROL = "public, max-age=3600"


class CrawlerRenderer(BaseRenderer):
	def can_render(self) -> bool:
		self.handler = None

		if self.path.endswith("/" + LLMS_TXT):
			return self._match_space_llms_txt(self.path[: -len("/" + LLMS_TXT)])

		if self.path.endswith(MARKDOWN_SUFFIX):
			return self._match_markdown()

		return False

	def render(self):
		return self.handler()

	# -- llms.txt ---------------------------------------------------------

	def _match_space_llms_txt(self, route: str) -> bool:
		space = frappe.db.get_value("Wiki Space", {"route": route, "is_published": 1}, "name")
		if not space or not can_read_space(space, "Guest"):
			return False

		self.llms_txt_space = space
		self.handler = self._render_space_llms_txt
		return True

	def _render_space_llms_txt(self):
		from wiki.wiki.llms_txt import build_space_llms_txt

		body = build_space_llms_txt(self.llms_txt_space)
		if not body:
			# An empty space has no index to serve; 404 rather than an empty file.
			frappe.throw(frappe._("Page not found"), frappe.DoesNotExistError)

		return _text_response(body)

	# -- <route>.md -------------------------------------------------------

	def _match_markdown(self) -> bool:
		# A page can legitimately be routed at something ending in ".md". Its own
		# URL stays HTML -- it is handed straight to WikiDocumentRenderer -- and
		# its markdown lives one suffix further out, at "<route>.md".
		if frappe.db.exists("Wiki Document", {"route": self.path}):
			return False

		route = self.path[: -len(MARKDOWN_SUFFIX)]

		# Mirrors WikiDocumentRenderer.can_render: a published leaf wins, and a
		# group / space route with no page of its own redirects to its first
		# published page -- here, to that page's `.md`.
		leaf = frappe.db.get_value(
			"Wiki Document",
			{"route": route, "is_group": 0, "is_published": 1, "is_external_link": 0},
			"name",
		)
		if leaf:
			self.wiki_doc_name = leaf
			self.handler = self._render_markdown
			return True

		root_group = frappe.db.get_value(
			"Wiki Document", {"route": route, "is_group": 1}, "name"
		) or frappe.db.get_value("Wiki Space", {"route": route, "is_published": 1}, "root_group")

		if root_group:
			first_page = get_first_published_page(root_group)
			if first_page:
				frappe.redirect("/" + first_page["route"] + MARKDOWN_SUFFIX)

		return False

	def _render_markdown(self):
		doc = frappe.get_cached_doc("Wiki Document", self.wiki_doc_name)
		# 404 rather than 403 on a restricted space, so a `.md` URL cannot be used
		# to probe for pages the reader itself would hide.
		doc.check_space_access("read")
		doc.check_published()
		return build_markdown_response(doc)


def _text_response(body: str) -> Response:
	"""text/plain rather than text/markdown so a browser shows these in-tab.

	Raw werkzeug, like build_markdown_response — build_response's page headers
	mean nothing on a crawler index.
	"""
	response = Response()
	response.data = body
	response.headers["Content-Type"] = "text/plain; charset=utf-8"
	response.headers["Cache-Control"] = INDEX_CACHE_CONTROL
	return response
