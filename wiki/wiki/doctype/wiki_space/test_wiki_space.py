# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki.doctype.wiki_space.wiki_space import clone_wiki_space


class TestWikiSpaceClone(FrappeTestCase):
	TEST_SITE = "wiki.localhost"

	def setUp(self):
		frappe.set_user("Administrator")
		self.space = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"space_name": f"Clone Source {frappe.generate_hash(length=6)}",
				"route": f"source-space-{frappe.generate_hash(length=6)}",
			}
		).insert()
		self.group_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Group A",
				"is_group": 1,
				"parent_wiki_document": self.space.root_group,
			}
		).insert()

		self.page_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Page A",
				"parent_wiki_document": self.group_doc.name,
				"content": "Hello from the source space.",
			}
		).insert()

	def test_clone_wiki_space_copies_tree_and_routes(self):
		new_route = f"clone-space-{frappe.generate_hash(length=6)}"
		new_space_name = clone_wiki_space(self.space.name, new_route)
		new_space = frappe.get_doc("Wiki Space", new_space_name)

		self.assertEqual(new_space.route, new_route)
		self.assertNotEqual(new_space.root_group, self.space.root_group)

		new_root = frappe.get_doc("Wiki Document", new_space.root_group)
		self.assertEqual(new_root.route, new_route)

		root_lft, root_rgt = frappe.get_value("Wiki Document", self.space.root_group, ["lft", "rgt"])
		new_root_lft, new_root_rgt = frappe.get_value("Wiki Document", new_space.root_group, ["lft", "rgt"])

		original_docs = frappe.get_all(
			"Wiki Document",
			filters={"lft": (">=", root_lft), "rgt": ("<=", root_rgt)},
			fields=["name"],
		)
		new_docs = frappe.get_all(
			"Wiki Document",
			filters={"lft": (">=", new_root_lft), "rgt": ("<=", new_root_rgt)},
			fields=["name"],
		)
		self.assertEqual(len(original_docs), len(new_docs))

		new_group = frappe.get_all(
			"Wiki Document",
			filters={
				"lft": (">=", new_root.lft),
				"rgt": ("<=", new_root.rgt),
				"title": self.group_doc.title,
				"is_group": 1,
			},
			fields=["name", "slug", "route"],
		)[0]
		new_page = frappe.get_all(
			"Wiki Document",
			filters={
				"lft": (">=", new_root.lft),
				"rgt": ("<=", new_root.rgt),
				"title": self.page_doc.title,
				"is_group": 0,
			},
			fields=["name", "slug", "route", "content", "parent_wiki_document"],
		)[0]

		expected_route = f"{new_route}/{new_group['slug']}/{new_page['slug']}"
		self.assertEqual(new_page["route"], expected_route)
		self.assertEqual(new_page["content"], self.page_doc.content)
		self.assertEqual(new_page["parent_wiki_document"], new_group["name"])

	def tearDown(self):
		frappe.db.rollback()
