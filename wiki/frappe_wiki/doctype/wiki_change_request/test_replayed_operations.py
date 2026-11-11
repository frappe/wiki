# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe

from wiki.frappe_wiki.doctype.wiki_change_request.test_wiki_change_request import (
	create_test_wiki_document,
	create_test_wiki_space,
)
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	MAX_APPLIED_OP_IDS,
	apply_cr_operations,
	create_change_request,
	get_cr_page,
)
from wiki.tests import WikiTestCase


class TestReplayedOperations(WikiTestCase):
	def setUp(self):
		super().setUp()
		self.space = create_test_wiki_space()
		self.page = create_test_wiki_document(self.space.root_group, title="Page", content="Start.")
		self.cr = create_change_request(self.space.name, "Draft")
		self.root_key = frappe.db.get_value("Wiki Document", self.space.root_group, "doc_key")
		self.page_key = frappe.db.get_value("Wiki Document", self.page.name, "doc_key")

	def rename(self, title, op_id="op1"):
		op = {"type": "update_node", "doc_key": self.page_key, "fields": {"title": title}}
		if op_id:
			op["op_id"] = op_id
		return apply_cr_operations(self.cr.name, operations=[op])

	def versions(self):
		return frappe.db.get_value(
			"Wiki Change Request", self.cr.name, ["operation_version", "structure_version"]
		)

	def test_replayed_op_writes_nothing(self):
		self.rename("First")
		frappe.db.set_value(
			"Wiki Revision Item",
			{"revision": self.cr.head_revision, "doc_key": self.page_key},
			"title",
			"Changed since",
		)
		before = self.versions()

		result = self.rename("First")

		self.assertTrue(result["ok"])
		self.assertEqual(self.versions(), before)
		self.assertEqual(result["change_summary"]["count"], 0)
		self.assertEqual(get_cr_page(self.cr.name, self.page_key)["title"], "Changed since")

	def test_replayed_op_still_reports_the_page_with_its_hash(self):
		self.rename("First")
		result = self.rename("First")
		item = next(item for item in result["items"] if item["doc_key"] == self.page_key)
		self.assertEqual(item["content_hash"], get_cr_page(self.cr.name, self.page_key)["content_hash"])

	def test_op_without_an_id_always_applies(self):
		self.rename("First", op_id=None)
		before = self.versions()[0]
		self.rename("Second", op_id=None)
		self.assertEqual(self.versions()[0], before + 1)
		self.assertEqual(get_cr_page(self.cr.name, self.page_key)["title"], "Second")

	def test_mixed_batch_applies_only_the_new_op(self):
		self.rename("First")
		result = apply_cr_operations(
			self.cr.name,
			operations=[
				{
					"type": "update_node",
					"op_id": "op1",
					"doc_key": self.page_key,
					"fields": {"title": "Replayed"},
				},
				{
					"type": "update_node",
					"op_id": "op2",
					"doc_key": self.page_key,
					"fields": {"is_published": 0},
				},
			],
		)
		self.assertEqual(result["change_summary"]["count"], 1)
		page = get_cr_page(self.cr.name, self.page_key)
		self.assertEqual(page["title"], "First")
		self.assertFalse(page["is_published"])

	def test_replayed_content_is_left_out_of_the_page_check(self):
		save = {"type": "update_content", "op_id": "save", "doc_key": self.page_key, "content": "Mine."}
		apply_cr_operations(self.cr.name, operations=[save])
		apply_cr_operations(
			self.cr.name,
			operations=[{"type": "update_content", "doc_key": self.page_key, "content": "Theirs."}],
		)

		result = apply_cr_operations(self.cr.name, operations=[{**save, "base_content_hash": "stale"}])

		self.assertTrue(result["ok"])
		self.assertEqual(get_cr_page(self.cr.name, self.page_key)["content"], "Theirs.")

	def test_replayed_move_is_left_out_of_the_structure_check(self):
		move = {
			"type": "move_node",
			"op_id": "move",
			"doc_key": self.page_key,
			"target_parent_key": self.root_key,
			"order_index": 0,
		}
		first = apply_cr_operations(self.cr.name, operations=[move])
		stale = first["structure_version"] - 1

		result = apply_cr_operations(self.cr.name, operations=[move], base_structure_version=stale)

		self.assertTrue(result["ok"])
		self.assertNotIn("structure_version", result)
		self.assertEqual(self.versions()[1], first["structure_version"])

	def test_new_move_still_conflicts_when_the_tree_moved_on(self):
		move = {
			"type": "move_node",
			"op_id": "move",
			"doc_key": self.page_key,
			"target_parent_key": self.root_key,
			"order_index": 0,
		}
		first = apply_cr_operations(self.cr.name, operations=[move])

		result = apply_cr_operations(
			self.cr.name,
			operations=[{**move, "op_id": "next"}],
			base_structure_version=first["structure_version"] - 1,
		)

		self.assertEqual(result["error"], "structure_conflict")
		applied = frappe.parse_json(
			frappe.db.get_value("Wiki Change Request", self.cr.name, "applied_op_ids")
		)
		self.assertNotIn("next", applied)

	def test_applied_ids_stay_capped_and_drop_the_oldest(self):
		operations = [
			{
				"type": "update_node",
				"op_id": f"op{index}",
				"doc_key": self.page_key,
				"fields": {"title": f"Title {index}"},
			}
			for index in range(MAX_APPLIED_OP_IDS + 5)
		]
		apply_cr_operations(self.cr.name, operations=operations)

		applied = frappe.parse_json(
			frappe.db.get_value("Wiki Change Request", self.cr.name, "applied_op_ids")
		)
		self.assertEqual(len(applied), MAX_APPLIED_OP_IDS)
		self.assertNotIn("op0", applied)
		self.assertIn(f"op{MAX_APPLIED_OP_IDS + 4}", applied)

	def test_bad_op_id_is_rejected(self):
		for op_id in (123, "x" * 65):
			with self.assertRaises(frappe.ValidationError):
				self.rename("Bad", op_id=op_id)
