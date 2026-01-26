import re
from urllib.parse import quote

import frappe
from frappe.website.page_renderers.document_page import DocumentPage
from frappe.website.utils import build_response

from wiki.wiki.doctype.wiki_page.wiki_page import get_sidebar_for_page

reg = None  # sidebar substitution disabled to prevent character injection


class WikiPageRenderer(DocumentPage):
	def can_render(self):
		doctype = "Wiki Page"
		try:
			self.docname = frappe.db.get_value(doctype, {"route": self.path, "published": 1}, "name")
			if self.docname:
				self.doctype = doctype
				return True
		except Exception as e:
			if not frappe.db.is_missing_column(e):
				raise e

		if wiki_space_name := frappe.db.get_value("Wiki Space", {"route": self.path}):
			wiki_space = frappe.get_cached_doc("Wiki Space", wiki_space_name)
			topmost_wiki_route = frappe.db.get_value(
				"Wiki Page", wiki_space.wiki_sidebars[0].wiki_page, "route"
			)
			frappe.redirect(f"/{quote(topmost_wiki_route)}")

	def get_context(self):
		context = super().get_context()
		lang = (context.get("lang") or "").lower()
		path = f"/{(self.path or '').lower().strip('/')}/"

		# Force LTR if the language starts with English (en-US, en-GB) or path contains /en/
		if lang.startswith("en") or "/en/" in path:
				context.text_direction = "ltr"
				# Disable global Frappe RTL flag for English content
				frappe.local.is_rtl = False
		else:
				# Respect global RTL detection for non-English content
				context.text_direction = "rtl" if frappe.local.is_rtl else "ltr"

		return context

	def render(self):
		html = self.get_html()
		html = self.add_csrf_token(html)
		html = self.add_sidebar(html)
		return build_response(self.path, html, self.http_status_code or 200, self.headers)

	def add_sidebar(self, html):
		if not reg:
			return html
		sidebar = get_sidebar_for_page(self.docname)
		return reg.sub(sidebar, html)