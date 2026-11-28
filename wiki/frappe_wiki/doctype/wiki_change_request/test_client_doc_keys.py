# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe

from wiki.frappe_wiki.doctype.wiki_change_request.test_wiki_change_request import (
	_approve_and_merge,
	create_test_wiki_document,
	create_test_wiki_space,
)
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	apply_cr_operations,
	create_change_request,
	get_cr_page,
)
from wiki.tests import WikiTestCase


class TestClientDocKeys(WikiTestCase):
	def setUp(self):
		super().setUp()
		self.space = create_test_wiki_space()
		self.page = create_test_wiki_document(self.space.root_group, title="Page", content="Start.")
		self.cr = create_change_request(self.space.name, "Draft")
		self.root_key = frappe.db.get_value("Wiki Document", self.space.root_group, "doc_key")
		self.page_key = frappe.db.get_value("Wiki Document", self.page.name, "doc_key")
		self.key = frappe.generate_hash(length=32)

	def create(self, doc_key=None, **fields):
		op = {
			"type": "create_node",
			"doc_key": doc_key or self.key,
			"parent_key": self.root_key,
			"title": "New",
			**fields,
		}
		return apply_cr_operations(self.cr.name, operations=[op])

	def overlay_rows(self, doc_key):
		return frappe.db.count("Wiki Revision Item", {"revision": self.cr.head_revision, "doc_key": doc_key})

	def test_create_uses_the_key_the_client_chose(self):
		result = self.create(content="Body")
		self.assertTrue(result["ok"])
		self.assertEqual(result["items"][0]["doc_key"], self.key)
		self.assertEqual(result["temp_key_map"], {})
		self.assertEqual(get_cr_page(self.cr.name, self.key)["content"], "Body")

	def test_temp_key_still_maps_alongside_a_client_key(self):
		result = self.create(temp_key="t1")
		self.assertEqual(result["temp_key_map"], {"t1": self.key})

	def test_a_create_needs_a_temp_key_or_a_doc_key(self):
		with self.assertRaises(frappe.ValidationError):
			apply_cr_operations(
				self.cr.name,
				operations=[{"type": "create_node", "parent_key": self.root_key, "title": "New"}],
			)

	def test_a_child_can_use_a_parent_created_in_the_same_batch(self):
		child_key = frappe.generate_hash(length=32)
		apply_cr_operations(
			self.cr.name,
			operations=[
				{
					"type": "create_node",
					"doc_key": self.key,
					"parent_key": self.root_key,
					"title": "Group",
					"is_group": 1,
				},
				{"type": "create_node", "doc_key": child_key, "parent_key": self.key, "title": "Child"},
			],
		)
		self.assertEqual(get_cr_page(self.cr.name, child_key)["parent_key"], self.key)

	def test_a_badly_formed_key_is_rejected(self):
		for bad_key in (
			"short",
			"a" * 33,
			"01234567-89ab-cdef-0123-456789abcdef",
			"0123456789ab\n",
			'0123456789ab"><script>',
			12345678901234,
		):
			with self.subTest(bad_key=bad_key), self.assertRaises(frappe.ValidationError):
				self.create(doc_key=bad_key)

	def test_a_key_on_a_page_in_another_space_is_rejected(self):
		other_space = create_test_wiki_space()
		other = create_test_wiki_document(other_space.root_group, title="Other", content="Keep me.")
		other_key = frappe.db.get_value("Wiki Document", other.name, "doc_key")

		with self.assertRaises(frappe.ValidationError):
			self.create(doc_key=other_key, title="Taken over", content="Overwritten.")

		self.assertEqual(self.overlay_rows(other_key), 0)

	def test_a_key_in_the_base_revision_is_rejected(self):
		frappe.db.delete("Wiki Document", {"name": self.page.name})
		with self.assertRaises(frappe.ValidationError):
			self.create(doc_key=self.page_key)

	def test_a_retried_create_changes_nothing(self):
		self.create(content="First.")
		apply_cr_operations(
			self.cr.name,
			operations=[{"type": "update_content", "doc_key": self.key, "content": "Newer."}],
		)

		result = self.create(content="First.")

		self.assertTrue(result["ok"])
		self.assertEqual(self.overlay_rows(self.key), 1)
		self.assertEqual(result["items"][0]["doc_key"], self.key)
		self.assertEqual(result["items"][0]["content"], "Newer.")

	def test_a_merge_keeps_the_client_key(self):
		self.create(content="Body")
		_approve_and_merge(self.cr.name)
		self.assertEqual(frappe.db.get_value("Wiki Document", {"doc_key": self.key}, "content"), "Body")
