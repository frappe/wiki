import re
from urllib.parse import quote

import frappe
from frappe.website.page_renderers.document_page import DocumentPage
from frappe.website.utils import build_response

from wiki.wiki.doctype.wiki_page.wiki_page import get_sidebar_for_page

reg = re.compile("<!--sidebar-->")


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

	def render(self):
		html = self.get_html()
		html = self.add_csrf_token(html)
		html = self.add_sidebar(html)
		return build_response(self.path, html, self.http_status_code or 200, self.headers)

	def add_sidebar(self, html):
		return reg.sub(get_sidebar_for_page(self.docname), html)
