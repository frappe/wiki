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
	get_landing_page_for_route,
)
from wiki.permissions import can_read_space

MARKDOWN_SUFFIX = ".md"
LLMS_TXT = "llms.txt"
SITEMAP_XML = "sitemap.xml"

# Guest-only, published content with no per-user variation, so a shared cache
# can hold it. Short enough that a newly published page shows up within the hour.
INDEX_CACHE_CONTROL = "public, max-age=3600"


class CrawlerRenderer(BaseRenderer):
	def can_render(self) -> bool:
		self.handler = None

		if self.path == LLMS_TXT:
			from wiki.wiki.llms_txt import build_site_llms_txt

			return self._match_index(build_site_llms_txt())

		if self.path.endswith("/" + LLMS_TXT):
			return self._match_space_llms_txt(self.path[: -len("/" + LLMS_TXT)])

		if self.path == SITEMAP_XML:
			from wiki.wiki.sitemap import build_sitemap_xml

			return self._match_sitemap(build_sitemap_xml())

		if self.path.endswith(MARKDOWN_SUFFIX):
			return self._match_markdown()

		return False

	def render(self):
		return self.handler()

	# -- llms.txt ---------------------------------------------------------

	def _match_space_llms_txt(self, route: str) -> bool:
		from wiki.wiki.llms_txt import build_space_llms_txt

		space = frappe.db.get_value("Wiki Space", {"route": route, "is_published": 1}, "name")
		if not space or not can_read_space(space, "Guest"):
			return False

		return self._match_index(build_space_llms_txt(space))

	def _match_index(self, body: str | None) -> bool:
		"""Claim the route only when there is an index to serve.

		A wiki with nothing public leaves /llms.txt to whatever the site had
		there before, rather than taking it over to serve an empty file.
		"""
		if not body:
			return False

		self.index_body = body
		self.handler = self._render_index
		return True

	def _render_index(self):
		return _text_response(self.index_body)

	# -- sitemap.xml ------------------------------------------------------

	def _match_sitemap(self, body: str | None) -> bool:
		"""Claim /sitemap.xml only when the wiki has routes to contribute.

		A site with no public wiki keeps frappe's own sitemap page, so
		installing this app never costs it its existing sitemap.
		"""
		if not body:
			return False

		self.index_body = body
		self.handler = self._render_sitemap
		return True

	def _render_sitemap(self):
		response = _text_response(self.index_body)
		response.headers["Content-Type"] = "application/xml; charset=utf-8"
		return response

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

		# get_landing_page_for_route gates on space access, so a restricted space's
		# `.md` URL 404s instead of naming its first page in a Location header.
		first_page = get_landing_page_for_route(route)
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
