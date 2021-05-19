# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document
from ghdiff import diff
from frappe import _
from frappe.desk.form.utils import add_comment
class WikiPagePatch(Document):
	def validate(self):
		self.new_preview_store = frappe.utils.md_to_html(self.new_code)
		if not self.new:
			self.orignal_code = frappe.db.get_value("Wiki Page", self.wiki_page, "content")
			self.diff = diff(self.orignal_code, self.new_code)
			self.orignal_preview_store = frappe.utils.md_to_html(self.orignal_code)

	def on_submit(self):
		
		if self.status != "Approved":
			frappe.throw(_('Please approve the Request before submitting'))
		wiki_page = frappe.get_doc("Wiki Page", self.wiki_page)

		if not self.new:
			wiki_page.update_page(wiki_page.title, self.new_code, self.message)
			return

		wiki_sidebar_parent = frappe.get_all( "Wiki Sidebar Item", filters=[[ 'wiki_page','=',wiki_page.name]], fields=['parent']  )
		
		if not wiki_sidebar_parent:
			frappe.throw("Unable to decide Sidebar")
		wiki_sidebar_parent = wiki_sidebar_parent[0].get('parent')
		new_wiki_page = frappe.new_doc("Wiki Page")

		wiki_page_dict = {
				"title": self.new_title,
				"content": self.new_code,
				"route": '/'.join(wiki_page.route.split('/')[:-1] + [ frappe.scrub(self.new_title)]),
				"published": 1
		}

		new_wiki_page.update(wiki_page_dict)
		new_wiki_page.save()



		new_wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
		new_wiki_sidebar_item_dict = {
			"wiki_page": new_wiki_page.name,
			"title": new_wiki_page.title,
			"parent": wiki_sidebar_parent,
			'parenttype': 'Wiki Sidebar',
			'route': new_wiki_page.route,
			'parentfield': 'sidebar_items'
		}

		print(new_wiki_sidebar_item_dict)

		new_wiki_sidebar_item.update(new_wiki_sidebar_item_dict)
		new_wiki_sidebar_item.save()


@frappe.whitelist()
def add_comment_to_patch(reference_name, content):
	email = frappe.session.user
	name = frappe.db.get_value("User", frappe.session.user, ["first_name"], as_dict=True).get("first_name")
	comment =  add_comment("Wiki Page Patch", reference_name, content, email, name)
	comment.timepassed = frappe.utils.pretty_date(comment.creation)
	return comment