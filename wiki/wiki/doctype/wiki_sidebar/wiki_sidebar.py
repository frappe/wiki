# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.utils.nestedset import NestedSet


class WikiSidebar(NestedSet):

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

		def find_parent(me):
			parent = frappe.db.get_value('Wiki Sidebar Item', { 'item' : me, 'type':'Wiki Sidebar' } , 'parent')
			if not parent:
				return me
			return find_parent(parent)

		topmost = find_parent(self.name)

		return frappe.get_doc('Wiki Sidebar', topmost).get_children(), topmost



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
