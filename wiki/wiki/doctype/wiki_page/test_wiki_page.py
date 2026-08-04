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

	def test_get_context_orders_revisions_by_creation_not_modified(self):
		"""`current_revision` is the newest revision, `previous_revision` the next.

		Frappe supplies a default `ORDER BY` from the doctype's `sort_field`,
		which for Wiki Page Revision is `modified DESC`. That is not the same
		thing as newest-first: touching an old revision's row moves it to the
		front and it is then presented as the current one. This gives `modified`
		the opposite order to `creation` so the two orderings disagree, and
		asserts the chronological answer.
		"""
		space = frappe.new_doc("Wiki Space")
		space.route = "wiki-revision-order-space"
		space.append("wiki_sidebars", {"parent_label": "Group", "wiki_page": self.wiki_page.name})
		space.insert()
		self.addCleanup(lambda: frappe.delete_doc("Wiki Space", space.name, force=True))

		# `after_insert` already made one revision; add two more, oldest first.
		ordered = frappe.db.get_all(
			"Wiki Page Revision", filters={"wiki_page": self.wiki_page.name}, pluck="name"
		)
		for content in ("second", "third"):
			revision = frappe.new_doc("Wiki Page Revision")
			revision.append("wiki_pages", {"wiki_page": self.wiki_page.name})
			revision.content = content
			revision.message = content
			revision.insert()
			ordered.append(revision.name)

		self.assertEqual(len(ordered), 3)
		oldest, middle, newest = ordered

		# `creation` ascends with insertion; `modified` runs the other way, so
		# the default `modified DESC` ordering puts the *oldest* revision first.
		for name, created, modified in (
			(oldest, "2024-01-01 10:00:00", "2024-06-03 10:00:00"),
			(middle, "2024-01-02 10:00:00", "2024-06-02 10:00:00"),
			(newest, "2024-01-03 10:00:00", "2024-06-01 10:00:00"),
		):
			frappe.db.set_value(
				"Wiki Page Revision", name, {"creation": created, "modified": modified},
				update_modified=False,
			)

		context = frappe._dict()
		frappe.get_doc("Wiki Page", self.wiki_page.name).get_context(context)

		self.assertEqual(context.current_revision.name, newest)
		self.assertEqual(context.previous_revision.name, middle)
		self.assertNotIn(oldest, [context.current_revision.name, context.previous_revision.name])

	def test_get_context_handles_a_page_with_one_revision(self):
		"""A single revision still yields the placeholder for the previous one."""
		space = frappe.new_doc("Wiki Space")
		space.route = "wiki-single-revision-space"
		space.append("wiki_sidebars", {"parent_label": "Group", "wiki_page": self.wiki_page.name})
		space.insert()
		self.addCleanup(lambda: frappe.delete_doc("Wiki Space", space.name, force=True))

		self.assertEqual(
			len(frappe.db.get_all("Wiki Page Revision", filters={"wiki_page": self.wiki_page.name})), 1
		)

		context = frappe._dict()
		frappe.get_doc("Wiki Page", self.wiki_page.name).get_context(context)

		self.assertEqual(context.previous_revision["name"], "")
		self.assertEqual(context.previous_revision["content"], "<h3>No Revisions</h3>")

	def test_wiki_page_deletion(self):
		delete_wiki_page(f"{self.wiki_page.route}")
		self.assertEqual(frappe.db.exists("Wiki Page", self.wiki_page.name), None)

		patches = frappe.get_all("Wiki Page Patch", {"wiki_page": self.wiki_page.name}, pluck="name")
		self.assertEqual(patches, [])

		sidebar_items = frappe.get_all("Wiki Group Item", {"wiki_page": self.wiki_page.name}, pluck="name")
		self.assertEqual(sidebar_items, [])
