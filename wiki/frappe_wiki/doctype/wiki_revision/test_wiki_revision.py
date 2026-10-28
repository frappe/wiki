# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe

from wiki.api.wiki_space import flush_pending_revision_syncs
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	create_change_request,
	delete_cr_page,
	get_cr_tree,
	merge_change_request,
	update_cr_page,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
	create_revision_from_live_tree,
	get_revision_item_map,
)
from wiki.tests import WikiTestCase
from wiki.tests.factory import make_space


class TestDeltaRevisions(WikiTestCase):
	def setUp(self):
		self.space = make_space(
			pages=[{"title": f"Page {index}", "content": f"v0 {index}"} for index in range(3)]
		)
		self.pages = {
			doc.title: doc
			for doc in frappe.get_all(
				"Wiki Document",
				filters={"parent_wiki_document": self.space.root_group},
				fields=["name", "title", "doc_key"],
			)
		}
		flush_pending_revision_syncs()

	def tearDown(self):
		frappe.db.rollback()

	def merge(self, edit):
		cr = create_change_request(self.space.name, "Delta")
		edit(cr)
		frappe.db.set_value("Wiki Change Request", cr.name, "status", "Approved")
		return frappe.get_doc("Wiki Revision", merge_change_request(cr.name))

	def edit_page(self, title, content):
		return lambda cr: update_cr_page(cr.name, self.pages[title].doc_key, {"content": content})

	def stored_rows(self, revision):
		return frappe.get_all(
			"Wiki Revision Item", filters={"revision": revision.name}, fields=["doc_key", "is_deleted"]
		)

	def content(self, revision, title):
		item = get_revision_item_map(revision.name)[self.pages[title].doc_key]
		return frappe.db.get_value("Wiki Content Blob", item.content_blob, "content")

	def test_merge_stores_only_the_changed_page(self):
		previous_main = frappe.db.get_value("Wiki Space", self.space.name, "main_revision")

		merge = self.merge(self.edit_page("Page 1", "v1"))

		self.assertEqual(merge.is_overlay, 1)
		self.assertEqual(merge.parent_revision, previous_main)
		self.assertEqual(
			self.stored_rows(merge), [{"doc_key": self.pages["Page 1"].doc_key, "is_deleted": 0}]
		)
		self.assertEqual(len(get_revision_item_map(merge.name)), 4)
		self.assertEqual(self.content(merge, "Page 1"), "v1")
		self.assertEqual(self.content(merge, "Page 2"), "v0 2")

	def test_merged_deletion_is_a_tombstone_that_later_change_requests_do_not_see(self):
		page_key = self.pages["Page 2"].doc_key

		merge = self.merge(lambda cr: delete_cr_page(cr.name, page_key))

		self.assertEqual(self.stored_rows(merge), [{"doc_key": page_key, "is_deleted": 1}])
		self.assertNotIn(page_key, get_revision_item_map(merge.name))
		next_cr = create_change_request(self.space.name, "After delete")
		self.assertNotIn(page_key, get_revision_item_map(next_cr.head_revision))
		self.assertNotIn(page_key, {node["doc_key"] for node in get_cr_tree(next_cr.name)["children"]})

	def test_chain_writes_a_full_checkpoint_once_its_rows_reach_the_page_count(self):
		merges = [self.merge(self.edit_page("Page 0", f"v{index}")) for index in range(1, 6)]

		# Four pages with the root: three one-row overlays, then 3 + 1 rows reach four.
		self.assertEqual([merge.is_overlay for merge in merges], [1, 1, 1, 0, 1])
		self.assertEqual(len(self.stored_rows(merges[3])), 4)
		self.assertEqual(self.content(merges[4], "Page 0"), "v5")
		self.assertEqual(self.content(merges[2], "Page 0"), "v3")

	def test_desk_edit_snapshot_stores_only_the_edited_page(self):
		page = frappe.get_doc("Wiki Document", self.pages["Page 0"].name)
		page.content = "desk edit"
		page.save()
		flush_pending_revision_syncs()

		main = frappe.get_doc(
			"Wiki Revision", frappe.db.get_value("Wiki Space", self.space.name, "main_revision")
		)
		self.assertEqual(main.is_overlay, 1)
		self.assertEqual(self.stored_rows(main), [{"doc_key": page.doc_key, "is_deleted": 0}])
		self.assertEqual(self.content(main, "Page 0"), "desk edit")

	def test_full_snapshot_writes_items_in_one_insert(self):
		inserts = []
		original = frappe.db.sql

		def counting(query, *args, **kwargs):
			if str(query).lstrip().upper().startswith("INSERT INTO `TABWIKI REVISION ITEM`"):
				inserts.append(query)
			return original(query, *args, **kwargs)

		frappe.db.sql = counting
		try:
			revision = create_revision_from_live_tree(self.space.name)
		finally:
			frappe.db.sql = original

		self.assertEqual(len(inserts), 1)
		self.assertEqual(len(self.stored_rows(revision)), 4)
