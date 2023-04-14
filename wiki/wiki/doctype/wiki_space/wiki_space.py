# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt
import json
from random import random

import frappe
import pymysql
from frappe.model.document import Document
from frappe.website.utils import cleanup_page_name


class WikiSpace(Document):
	def on_update(self):
		# prepend space route to the route of wiki page
		for wiki_sidebar in self.wiki_sidebars:
			wiki_page = frappe.get_doc("Wiki Page", wiki_sidebar.wiki_page)
			prepend_string = f"{self.route}/" if self.route else ""
			if prepend_string == wiki_page.route[::-1].split("/", 1)[-1][::-1]:
				return
			try:
				frappe.db.set_value(
					"Wiki Page",
					wiki_page.name,
					{"route": f"{prepend_string}{wiki_page.route.split('/')[-1]}"},
				)
			except pymysql.err.IntegrityError:
				try:
					# prepending group name
					frappe.db.set_value(
						"Wiki Page",
						wiki_page.name,
						{
							"route": f"{prepend_string}{cleanup_page_name(wiki_sidebar.parent_label)}-{wiki_page.route.split('/')[-1]}"
						},
					)
				except pymysql.err.IntegrityError:
					# prepending group name and appending random number
					frappe.db.set_value(
						"Wiki Page",
						wiki_page.name,
						{
							"route": f"{prepend_string}{cleanup_page_name(wiki_sidebar.parent_label)}-{wiki_page.route.split('/')[-1]}-{random() * 10000}"
						},
					)


@frappe.whitelist()
def update_sidebar(sidebar_items):
	sidebars = json.loads(sidebar_items)

	sidebar_items = sidebars.items()
	if sidebar_items:
		idx = 0
		for sidebar, items in sidebar_items:
			for item in items:
				idx += 1
				frappe.db.set_value(
					"Wiki Group Item", {"wiki_page": item["name"]}, {"parent_label": sidebar, "idx": idx}
				)

	for key in frappe.cache().hgetall("wiki_sidebar").keys():
		frappe.cache().hdel("wiki_sidebar", key)
