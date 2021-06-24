# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document


class WikiSidebar(Document):

	def get_children(self):
		out = self.get_sidebar_items()
		for sidebar_item in self.sidebar_items:
			if sidebar_item.type == 'Wiki Sidebar':
				sidebar = frappe.get_doc('Wiki Sidebar', sidebar_item.item)
				children = sidebar.get_children()
				out.append({
					"group_title": sidebar_item.title, 
					"group_items": children, 
					"name": sidebar.name, 
					"type": "Wiki Sidebar"
				})
		return out

	def get_items(self):

		topmost = self.find_topmost(self.name)

		sidebar_html = frappe.cache().hget('wiki_sidebar', topmost)

		if not sidebar_html:
			sidebar_items = frappe.get_doc('Wiki Sidebar', topmost).get_children()
			context = frappe._dict({})
			context.sidebar_items = sidebar_items
			sidebar_html = frappe.render_template('wiki/wiki/doctype/wiki_page/templates/web_sidebar.html', context)
			frappe.cache().hset('wiki_sidebar', topmost, sidebar_html)

		return sidebar_html, topmost



	def get_sidebar_items(self):
		items_without_group = []
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={"parent": self.name, "type": 'Wiki Page'},
			fields=["title", "item", 'name', 'type'],
			order_by="idx asc",
		)

		for item in items:
			item.item = "/" + item.item
			items_without_group.append(item)

		# return [{"group_title": "Topics", "group_items": items_without_group}] if items else []
		return items_without_group if items else []


	def validate(self):
		self.clear_cache()

	def on_trash(self):
		self.clear_cache()

	def on_update(self):
		self.clear_cache()

	def find_topmost(self,me):
		parent = frappe.db.get_value('Wiki Sidebar Item', { 'item' : me, 'type':'Wiki Sidebar' } , 'parent')
		if not parent:
			return me
		return self.find_topmost(parent)

	def clear_cache(self):
		topmost = self.find_topmost(self.name)
		frappe.cache().hdel('wiki_sidebar', topmost)