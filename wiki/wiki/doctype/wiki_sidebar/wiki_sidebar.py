# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.utils.nestedset import NestedSet

class WikiSidebar(NestedSet):
	def get_items(self):
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={'parent': self.name},
			fields=["title", "route", ],
			order_by="idx asc",
		)

		items_by_group = {}
		items_without_group = []

		for item in items:
			item.route =  '/' + item.route
			items_without_group.append(item)




		child_sidebars = frappe.get_all(
			"Wiki Sidebar",
			filters={'parent_wiki_sidebar': self.name},
			fields=["title" , "name"],
			order_by="idx asc",
		)

		if not child_sidebars:
			siblings = frappe.get_all(
				"Wiki Sidebar",
				filters={'parent_wiki_sidebar': self.parent_wiki_sidebar},
				fields=["title" , "name"],
				order_by="idx asc",
			)

			for child_sidebar in siblings:
				items = frappe.get_all(
					"Wiki Sidebar Item",
					filters={'parent': child_sidebar.name},
					fields=["title", "route", "parent"],
					order_by="idx asc",
				)

		

				for item in items:
					item.group=child_sidebar.title
					item.route =  '/' + item.route
					items_by_group.setdefault(child_sidebar.title, []).append(item)

			out = []
			for group, items in items_by_group.items():
				out.append({"group_title": group, "group_items": items})
			return out

		else:

			for child_sidebar in child_sidebars:
				items = frappe.get_all(
					"Wiki Sidebar Item",
					filters={'parent': child_sidebar.name},
					fields=["title", "route", "parent"],
					order_by="idx asc",
				)

				for item in items:
					item.group=child_sidebar.title
					item.route =  '/' + item.route
					items_by_group.setdefault(child_sidebar.title, []).append(item)

		out = []
		# out += items_without_group
		out.append({"group_title": self.title, "group_items": items_without_group})

		for group, items in items_by_group.items():
			out.append({"group_title": group, "group_items": items})
		

		return out