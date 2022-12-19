# Copyright (c) 2020, Frappe and Contributors
# See license.txt

import unittest

import frappe


class TestWikiPage(unittest.TestCase):
	def test_wiki_page_creation(self):
		wiki_page_id = frappe.db.exists("Wiki Page", {"route": "wiki/page"})
		if wiki_page_id:
			frappe.delete_doc("Wiki Page", wiki_page_id)
		for name in frappe.db.get_all("Wiki Page Revision", {"wiki_page": "wiki/page"}, pluck="name"):
			frappe.delete_doc("Wiki Page Revision", name)
		wiki_page = frappe.new_doc("Wiki Page")
		wiki_page.route = "wiki/page"
		wiki_page.content = "Hello World"
		wiki_page.title = "Hello World Title"
		wiki_page.save()
		self.assertEqual(
			frappe.db.get_value("Wiki Page", {"route": "wiki/page"}, "name"), wiki_page.name
		)

		wiki_page.delete()
