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
	def after_insert(self):
		add_comment_to_patch(self.name, self.message)
		frappe.db.commit()



	def on_submit(self):
		if self.status == 'Rejected':
			return

		if self.status != "Approved":
			frappe.throw(_("Please approve/ reject the request before submitting"))

		wiki_page = frappe.get_doc("Wiki Page", self.wiki_page)

		if self.new:
			self.create_new_wiki_page(wiki_page)
		else:
			self.update_old_page(wiki_page)
		if self.sidebar_edited == '1':
			self.update_sidebars()
			for key in frappe.cache().hgetall('wiki_sidebar').keys():
				frappe.cache().hdel('wiki_sidebar', key)

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

	def	update_old_page(self, wiki_page):
		wiki_page.update_page(self.new_title, self.new_code, self.message, self.raised_by)
		updated_page = frappe.get_all('Wiki Sidebar Item', {'item': self.wiki_page, 'type': 'Wiki Page'}, pluck = 'name')
		for page in updated_page:
			frappe.db.set_value('Wiki Sidebar Item', page, 'title', self.new_title)
		return

	def update_sidebars(self):
		if not self.new_sidebar_items:
			self.new_sidebar_items = '{}'
		sidebars = json.loads(self.new_sidebar_items)
		self.create_new_child(sidebars)
		sidebar_items = sidebars.items()
		if sidebar_items:
			for sidebar, items in sidebar_items:
				for idx, item in enumerate(items):
					if sidebar == 'docs/v13/user/manual/en':
						print(idx, item)
					frappe.db.set_value('Wiki Sidebar Item', item['name'], 'parent', sidebar)
					frappe.db.set_value('Wiki Sidebar Item', item['name'], 'idx', idx)

	def create_new_child(self, sidebars):
		for sidebar, items in sidebars.items():
			for item in items:
				if item['name'] == 'new-wiki-page':
					# new wiki page was created(/new)
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
					item['name'] = self.new_wiki_page.name

				elif item.get('new'):
					# new item was added via the add item button
					sidebar_name = item.get('name')
					if  item['type'] == 'Wiki Sidebar':
						# Create New Sidebar
						wiki_sidebar = frappe.new_doc("Wiki Sidebar")
						wiki_sidebar_dict = {
							"route": item.get('group_name'),
							"title": item.get('title'),
						}
						wiki_sidebar.update(wiki_sidebar_dict)
						wiki_sidebar.save()
						sidebar_name = wiki_sidebar.name

					# add new sidebar or page to wiki sidebar
					wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
					wiki_sidebar_item_dict = {
						"type": item['type'],
						"item":sidebar_name,
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
