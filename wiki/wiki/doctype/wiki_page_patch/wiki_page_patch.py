# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
import json
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

	def	update_old__page(self, wiki_page):
		wiki_page.update_page(wiki_page.title, self.new_code, self.message, self.raised_by)
		return

	def on_submit(self):

		if self.status != "Approved":
			frappe.throw(_("Please approve the Request before submitting"))
		wiki_page = frappe.get_doc("Wiki Page", self.wiki_page)

		if not self.new:
			self.update_old__page(wiki_page)
			self.update_sidebars()

			return

		wiki_sidebar_parent = self.get_wiki_sidebar_parent(wiki_page)

		self.create_new_wiki_page(wiki_page)

		# self.create_new_wiki_sidebar(wiki_sidebar_parent)

		self.update_sidebars()

	def get_wiki_sidebar_parent(self, wiki_page):

		wiki_sidebar_parent = frappe.get_all(
			"Wiki Sidebar Item", filters=[["item", "=", wiki_page.name]], fields=["parent"]
		)

		if not wiki_sidebar_parent:
			frappe.throw("Unable to decide Sidebar")

		return wiki_sidebar_parent[0].get("parent")

	def create_new_wiki_page(self, wiki_page):
		self.new_wiki_page = frappe.new_doc("Wiki Page")

		wiki_page_dict = {
			"title": self.new_title,
			"content": self.new_code,
			"route": "/".join(wiki_page.route.split("/")[:-1] + [frappe.scrub(self.new_title)]),
			"published": 1,
		}

		self.new_wiki_page.update(wiki_page_dict)
		self.new_wiki_page.save()

	def create_new_wiki_sidebar(self, wiki_sidebar_parent):
		new_wiki_sidebar_item = frappe.new_doc("Wiki Sidebar Item")
		new_wiki_sidebar_item_dict = {
			"item": self.new_wiki_page.name,
			"parent": wiki_sidebar_parent,
			"parenttype": "Wiki Sidebar",
			"route": self.new_wiki_page.route,
			"parentfield": "sidebar_items",
		}

		new_wiki_sidebar_item.update(new_wiki_sidebar_item_dict)
		new_wiki_sidebar_item.save()

	def update_sidebars(self):
		sidebars = json.loads(self.new_sidebar_items)
		print(sidebars)
		self.create_new_child(sidebars)
		
		for sidebar, items in sidebars.items():
			
			for idx, item in enumerate(items):
				frappe.db.set_value('Wiki Sidebar Item', item['name'], 'parent', sidebar)
				frappe.db.set_value('Wiki Sidebar Item', item['name'], 'idx', idx)

	def create_new_child(self, sidebars):
		for sidebar, items in sidebars.items():
			for item in items:
				# print("item")
				# print(item)
				if item['name'] == 'new':
					wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
					wiki_sidebar_item_dict = {
						"type": item['type'],
						"item": self.new_wiki_page.name,
						"parent": sidebar,
						'parenttype': 'Wiki Sidebar',
						'parentfield': 'sidebar_items'
					}
					wiki_sidebar_item.update(wiki_sidebar_item_dict)
					wiki_sidebar_item.save()
					item['name'] = wiki_sidebar_item.name
				elif item.get('new'):
					if  item['type'] == 'Wiki Sidebar':

						wiki_sidebar = frappe.new_doc("Wiki Sidebar")
						wiki_sidebar_dict = {
							"route": item.get('name'),
							"title": item.get('title'),
						}
						wiki_sidebar.update(wiki_sidebar_dict)
						wiki_sidebar.save()

					wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
					wiki_sidebar_item_dict = {
						"type": item['type'],
						"item": item.get('name'),
						"parent": sidebar,
						'parenttype': 'Wiki Sidebar',
						'parentfield': 'sidebar_items'
					}
					wiki_sidebar_item.update(wiki_sidebar_item_dict)
					wiki_sidebar_item.save()
					item['name'] = wiki_sidebar_item.name

@frappe.whitelist()
def add_comment_to_patch(reference_name, content):
	email = frappe.session.user
	name = frappe.db.get_value(
		"User", frappe.session.user, ["first_name"], as_dict=True
	).get("first_name")
	comment = add_comment("Wiki Page Patch", reference_name, content, email, name)
	comment.timepassed = frappe.utils.pretty_date(comment.creation)
	return comment
