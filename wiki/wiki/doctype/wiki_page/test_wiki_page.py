# Copyright (c) 2020, Frappe and Contributors
# See license.txt

import unittest

import frappe

from wiki.wiki.doctype.wiki_page.wiki_page import delete_wiki_page, update


class TestWikiPage(unittest.TestCase):
	def setUp(self):
		wiki_page_id = frappe.db.get_value("Wiki Page", {"route": "wiki/page"}, "name")
		if wiki_page_id:
			frappe.delete_doc("Wiki Page", wiki_page_id)
		for name in frappe.db.get_all("Wiki Page Revision", {"wiki_page": "wiki/page"}, pluck="name"):
			frappe.delete_doc("Wiki Page Revision", name)

		self.wiki_page = frappe.new_doc("Wiki Page")
		self.wiki_page.route = "wiki/page"
		self.wiki_page.content = "Hello World"
		self.wiki_page.title = "Hello World Title"

		self.wiki_page.save()

	def tearDown(self):
		self.wiki_page.delete()

	def test_wiki_page_lifecycle(self):
		self.assertEqual(
			frappe.db.get_value("Wiki Page", {"route": "wiki/page"}, "name"), self.wiki_page.name
		)

		update(
			name=self.wiki_page.name,
			content="New Content",
			title="New Title",
			message="test",
		)

		patches = frappe.get_all(
			"Wiki Page Patch",
			{"wiki_page": self.wiki_page.name},
			["message", "new_title", "new_code", "name"],
		)

		self.assertEqual(patches[0].message, "test")
		self.assertEqual(patches[0].new_title, "New Title")
		self.assertEqual(patches[0].new_code, "New Content")

		patch = frappe.get_doc("Wiki Page Patch", patches[0].name)
		patch.status = "Approved"
		patch.approved_by = "Administrator"
		patch.save()
		patch.submit()

		wiki_page = frappe.get_doc("Wiki Page", self.wiki_page.name)

		self.assertEqual(wiki_page.title, "New Title")
		self.assertEqual(wiki_page.content, "New Content")

		self.assertEqual(
			len(
				frappe.db.get_all(
					"Wiki Page Revision",
					filters={"wiki_page": wiki_page.name},
				)
			),
			2,
		)

	def test_wiki_page_deletion(self):
		delete_wiki_page(f"{self.wiki_page.route}")
		self.assertEqual(frappe.db.exists("Wiki Page", self.wiki_page.name), None)

		patches = frappe.get_all("Wiki Page Patch", {"wiki_page": self.wiki_page.name}, pluck="name")
		self.assertEqual(patches, [])

		sidebar_items = frappe.get_all("Wiki Group Item", {"wiki_page": self.wiki_page.name}, pluck="name")
		self.assertEqual(sidebar_items, [])
