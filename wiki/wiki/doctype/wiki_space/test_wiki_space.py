# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.nestedset import get_descendants_of

from wiki.wiki.doctype.wiki_space.patches.v3 import (
	migrate_orphan_pages_to_wiki_document,
	migrate_to_new_tree_document_structure,
)
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


class TestWikiSpaceMigration(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def create_legacy_wiki_page(self, route: str, title: str, content: str, published=1, allow_guest=1):
		page = frappe.get_doc(
			{
				"doctype": "Wiki Page",
				"title": title,
				"route": route,
				"content": content,
				"published": published,
				"allow_guest": allow_guest,
			}
		)
		page.db_insert()
		return page

	def create_legacy_space(self, route: str, sidebar_rows: list[dict]):
		space = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"space_name": f"Legacy Space {frappe.generate_hash(length=6)}",
				"route": route,
			}
		)
		for row in sidebar_rows:
			space.append("wiki_sidebars", row)
		return space.insert()

	def test_migrate_to_v3_is_idempotent_and_resumable(self):
		page_one = self.create_legacy_wiki_page(
			route=f"legacy-page-{frappe.generate_hash(length=6)}",
			title="Legacy Page One",
			content="Page one content",
		)
		page_two = self.create_legacy_wiki_page(
			route=f"legacy-page-{frappe.generate_hash(length=6)}",
			title="Legacy Page Two",
			content="Page two content",
			allow_guest=0,
		)
		space = self.create_legacy_space(
			route=f"space-{frappe.generate_hash(length=6)}",
			sidebar_rows=[
				{"wiki_page": page_one.name, "parent_label": "Getting Started"},
				{"wiki_page": page_two.name, "parent_label": "Getting Started"},
			],
		)

		self.assertEqual(get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True), [])

		space.migrate_to_v3()
		space.reload()

		first_descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		self.assertEqual(len(first_descendants), 3)

		group_name = frappe.db.get_value(
			"Wiki Document",
			{
				"parent_wiki_document": space.root_group,
				"is_group": 1,
				"route": f"{space.route}/getting-started",
			},
			"name",
		)
		self.assertTrue(group_name)

		page_one_doc = frappe.get_doc(
			"Wiki Document",
			frappe.db.get_value("Wiki Document", {"route": page_one.route, "is_group": 0}, "name"),
		)
		page_two_doc = frappe.get_doc(
			"Wiki Document",
			frappe.db.get_value("Wiki Document", {"route": page_two.route, "is_group": 0}, "name"),
		)
		self.assertEqual(page_one_doc.parent_wiki_document, group_name)
		self.assertEqual(page_one_doc.sort_order, 0)
		self.assertEqual(page_two_doc.parent_wiki_document, group_name)
		self.assertEqual(page_two_doc.sort_order, 1)

		space.migrate_to_v3()
		second_descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)

		self.assertEqual(first_descendants, second_descendants)
		self.assertEqual(
			frappe.db.count("Wiki Document", {"route": page_one.route, "is_group": 0}),
			1,
		)
		self.assertEqual(
			frappe.db.count("Wiki Document", {"route": f"{space.route}/getting-started", "is_group": 1}),
			1,
		)

	def test_migrate_to_v3_repairs_partial_migration(self):
		page_one = self.create_legacy_wiki_page(
			route=f"partial-page-{frappe.generate_hash(length=6)}",
			title="Partial Page One",
			content="Fresh content",
		)
		page_two = self.create_legacy_wiki_page(
			route=f"partial-page-{frappe.generate_hash(length=6)}",
			title="Partial Page Two",
			content="Second content",
		)
		space = self.create_legacy_space(
			route=f"partial-space-{frappe.generate_hash(length=6)}",
			sidebar_rows=[
				{"wiki_page": page_one.name, "parent_label": "Docs"},
				{"wiki_page": page_two.name, "parent_label": "Docs"},
			],
		)

		group_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Docs",
				"route": f"{space.route}/docs",
				"is_group": 1,
				"is_published": 1,
				"parent_wiki_document": space.root_group,
				"sort_order": 0,
			}
		).insert()
		stale_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Stale Title",
				"route": page_one.route,
				"is_group": 0,
				"is_published": 0,
				"content": "stale",
				"parent_wiki_document": group_doc.name,
				"sort_order": 99,
			}
		).insert()

		space.migrate_to_v3()

		stale_doc.reload()
		self.assertEqual(stale_doc.title, page_one.title)
		self.assertEqual(stale_doc.content, page_one.content)
		self.assertEqual(stale_doc.is_published, page_one.published)
		self.assertEqual(stale_doc.sort_order, 0)

		page_two_name = frappe.db.get_value("Wiki Document", {"route": page_two.route, "is_group": 0}, "name")
		self.assertTrue(page_two_name)
		self.assertEqual(frappe.db.count("Wiki Document", {"parent_wiki_document": group_doc.name}), 2)

	def test_v3_patch_migrates_spaces_even_when_root_group_exists(self):
		page = self.create_legacy_wiki_page(
			route=f"patch-page-{frappe.generate_hash(length=6)}",
			title="Patch Page",
			content="Patch content",
		)
		space = self.create_legacy_space(
			route=f"patch-space-{frappe.generate_hash(length=6)}",
			sidebar_rows=[{"wiki_page": page.name, "parent_label": "Guides"}],
		)

		self.assertTrue(space.root_group)
		self.assertEqual(get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True), [])

		migrate_to_new_tree_document_structure.execute()

		self.assertEqual(
			frappe.db.count("Wiki Document", {"route": page.route, "is_group": 0}),
			1,
		)
		self.assertEqual(
			frappe.db.count("Wiki Document", {"route": f"{space.route}/guides", "is_group": 1}),
			1,
		)

	def test_orphan_patch_upserts_existing_documents(self):
		page = self.create_legacy_wiki_page(
			route=f"orphan-page-{frappe.generate_hash(length=6)}",
			title="Orphan Page",
			content="Canonical content",
			allow_guest=0,
		)
		existing_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Old Title",
				"route": page.route,
				"is_group": 0,
				"is_published": 0,
				"content": "old content",
			}
		).insert()

		migrate_orphan_pages_to_wiki_document.execute()

		existing_doc.reload()
		self.assertEqual(existing_doc.title, page.title)
		self.assertEqual(existing_doc.content, page.content)
		self.assertEqual(existing_doc.is_published, page.published)
		self.assertEqual(frappe.db.count("Wiki Document", {"route": page.route, "is_group": 0}), 1)

	def tearDown(self):
		frappe.db.rollback()
