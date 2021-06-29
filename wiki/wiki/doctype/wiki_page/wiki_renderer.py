import re

import frappe
from frappe.website.utils import build_response
from frappe.website.page_renderers.document_page import DocumentPage
from frappe.website.router import get_doctypes_with_web_view

from wiki.wiki.doctype.wiki_page.wiki_page import 	get_sidebar_for_page

reg = re.compile('<!--sidebar-->')
class WikiPageRenderer(DocumentPage):

	def search_in_doctypes_with_web_view(self):
		for doctype in get_doctypes_with_web_view():
			if doctype != 'Wiki Page':
				continue
			filters = dict(route=self.path)
			meta = frappe.get_meta(doctype)
			condition_field = self.get_condition_field(meta)

			if condition_field:
				filters[condition_field] = 1

			try:
				self.docname = frappe.db.get_value(doctype, filters, 'name')
				if self.docname:
					self.doctype = doctype
					return True
			except Exception as e:
				if not frappe.db.is_missing_column(e):
					raise e

	def render(self):
		html = self.get_html()
		html = self.add_csrf_token(html)
		html = self.add_sidebar(html)
		return build_response(self.path, html, self.http_status_code or 200, self.headers)

	def add_sidebar(self, html):
		return reg.sub(get_sidebar_for_page(self.path), html)