# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.utils.nestedset import NestedSet


class WikiSidebar(NestedSet):
	def get_items(self):
		self.items_by_group = {}
		self.items_without_group = []

		self.get_sidebar_items()

		self.set_child_sidebars()



		if self.parent_wiki_sidebar:
			if not self.parent_wiki_sidebar:
				return []
			return frappe.get_doc("Wiki Sidebar", self.parent_wiki_sidebar).get_items()


		self.child_sidebars = sorted(self.child_sidebars, key=lambda x: x.title)

		for child_sidebar in self.child_sidebars:
			items = frappe.get_all(
				"Wiki Sidebar Item",
				filters={"parent": child_sidebar.name},
				fields=["title", "route", "parent"],
				order_by="idx asc",
			)

			sidebars = []

			for sidebar in frappe.get_all(
				"Wiki Sidebar", filters={"parent_wiki_sidebar": child_sidebar.name}
			):

				sidebars.extend(
					frappe.get_all(
						"Wiki Sidebar Item",
						filters={"route": sidebar.name},
						fields=["title", "route", "parent", "name"],
						order_by="idx asc",
					)
				)

			for item in items:
				item.group = child_sidebar.title
				item.route = "/" + item.route
				self.items_by_group.setdefault(child_sidebar.title, []).append(item)

			import json

			for item in sidebars:

				items = frappe.get_all(
					"Wiki Sidebar Item",
					filters={"parent": item.route},
					fields=["title", "route", "parent"],
					order_by="idx asc",
				)
				item.group_title =	item.title
				item.group_items =	items
				item.group = child_sidebar.title
				item.route = "/" + item.route
				self.items_by_group.setdefault(child_sidebar.title, []).append(item)

		out = []

		out.append({"group_title": "Topics", "group_items": self.items_without_group})

		for group, items in self.items_by_group.items():
			out.append({"group_title": group, "group_items": items})

		return out

	def get_sidebar_items(self):
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={"parent": self.name},
			fields=["title", "route",],
			order_by="idx asc",
		)

		for item in items:
			item.route = "/" + item.route
			self.items_without_group.append(item)


	def set_child_sidebars(self):
		self.child_sidebars= frappe.get_all(
			"Wiki Sidebar",
			filters={"parent_wiki_sidebar": self.name},
			fields=["title", "name"],
			order_by="idx asc",
		)