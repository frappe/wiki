# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import hashlib

import frappe
from frappe.database import get_db

from wiki.frappe_wiki.doctype.wiki_change_request.test_wiki_change_request import (
	create_test_wiki_document,
	create_test_wiki_space,
)
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	apply_cr_operations,
	create_change_request,
	create_cr_page,
	delete_cr_page,
	get_cr_page,
	get_cr_tree,
	move_cr_page,
	reorder_cr_children,
	restore_cr_page,
	update_cr_page,
)
from wiki.tests import WikiTestCase
from wiki.tests.factory import WikiFixtureMixin


def sha256(content: str) -> str:
	return hashlib.sha256(content.encode("utf-8")).hexdigest()


class DraftFixture:
	def make_draft(self):
		self.space = create_test_wiki_space()
		self.page = create_test_wiki_document(self.space.root_group, title="Page", content="Start.")
		self.other = create_test_wiki_document(self.space.root_group, title="Other", content="Other.")
		self.cr = create_change_request(self.space.name, "Draft")
		self.key = frappe.db.get_value("Wiki Document", self.page.name, "doc_key")
		self.other_key = frappe.db.get_value("Wiki Document", self.other.name, "doc_key")
		self.root_key = frappe.db.get_value("Wiki Document", self.space.root_group, "doc_key")

	def save(self, content, base=None, key=None):
		op = {"type": "update_content", "doc_key": key or self.key, "content": content}
		if base:
			op["base_content_hash"] = base
		return apply_cr_operations(self.cr.name, operations=[op])

	def content(self, key=None):
		return get_cr_page(self.cr.name, key or self.key)["content"]

	def structure_version(self):
		return get_cr_tree(self.cr.name)["structure_version"]


class TestPageContentCheck(DraftFixture, WikiTestCase):
	def setUp(self):
		super().setUp()
		self.make_draft()

	def test_page_and_batch_reply_carry_the_content_hash(self):
		self.assertEqual(get_cr_page(self.cr.name, self.key)["content_hash"], sha256("Start."))
		result = self.save("Next.")
		self.assertEqual(result["items"][0]["content_hash"], sha256("Next."))

	def test_save_on_the_current_copy_applies(self):
		result = self.save("Next.", base=sha256("Start."))
		self.assertTrue(result["ok"])
		self.assertEqual(self.content(), "Next.")

	def test_save_on_an_old_copy_returns_a_page_conflict(self):
		self.save("From B.", base=sha256("Start."))
		version = get_cr_tree(self.cr.name)["operation_version"]

		result = self.save("From A.", base=sha256("Start."))

		self.assertFalse(result["ok"])
		self.assertEqual(result["error"], "page_conflict")
		self.assertEqual(result["doc_key"], self.key)
		self.assertEqual(self.content(), "From B.")
		self.assertEqual(get_cr_tree(self.cr.name)["operation_version"], version)

	def test_retrying_a_save_the_server_already_has_succeeds(self):
		self.save("Next.", base=sha256("Start."))
		result = self.save("Next.", base=sha256("Start."))
		self.assertTrue(result["ok"])
		self.assertEqual(result["items"][0]["content_hash"], sha256("Next."))

	def test_save_without_a_hash_applies(self):
		self.save("From B.")
		self.assertTrue(self.save("From A.")["ok"])
		self.assertEqual(self.content(), "From A.")

	def test_saves_to_different_pages_do_not_conflict(self):
		base = sha256("Other.")
		self.save("From B.", base=sha256("Start."))
		result = self.save("From A.", base=base, key=self.other_key)
		self.assertTrue(result["ok"])
		self.assertEqual(self.content(self.other_key), "From A.")

	def test_a_stale_op_late_in_a_batch_writes_nothing(self):
		self.save("From B.", base=sha256("Start."))
		result = apply_cr_operations(
			self.cr.name,
			operations=[
				{"type": "update_node", "doc_key": self.other_key, "fields": {"title": "Renamed"}},
				{
					"type": "update_content",
					"doc_key": self.key,
					"content": "From A.",
					"base_content_hash": sha256("Start."),
				},
			],
		)
		self.assertEqual(result["error"], "page_conflict")
		self.assertEqual(get_cr_page(self.cr.name, self.other_key)["title"], "Other")

	def test_a_page_with_no_blob_hashes_as_empty(self):
		update_cr_page(self.cr.name, self.key, {"title": "Touched"})
		frappe.db.set_value(
			"Wiki Revision Item",
			{"revision": self.cr.head_revision, "doc_key": self.key},
			"content_blob",
			None,
		)
		self.assertEqual(get_cr_page(self.cr.name, self.key)["content_hash"], sha256(""))
		self.assertTrue(self.save("Next.", base=sha256(""))["ok"])

	def test_update_content_on_a_page_created_in_the_same_batch(self):
		result = apply_cr_operations(
			self.cr.name,
			operations=[
				{"type": "create_node", "temp_key": "t", "parent_key": self.root_key, "title": "New"},
				{
					"type": "update_content",
					"doc_key": "t",
					"content": "Body",
					"base_content_hash": sha256(""),
				},
			],
		)
		self.assertTrue(result["ok"])
		self.assertEqual(self.content(result["temp_key_map"]["t"]), "Body")


class TestStructureCheck(DraftFixture, WikiTestCase):
	def setUp(self):
		super().setUp()
		self.make_draft()

	def move(self, base=None):
		return apply_cr_operations(
			self.cr.name,
			base_structure_version=base,
			operations=[
				{
					"type": "reorder_children",
					"parent_key": self.root_key,
					"ordered_doc_keys": [self.other_key, self.key],
				}
			],
		)

	def create(self, title="New"):
		return apply_cr_operations(
			self.cr.name,
			operations=[
				{"type": "create_node", "temp_key": "t", "parent_key": self.root_key, "title": title}
			],
		)

	def test_tree_reports_the_structure_version(self):
		self.assertEqual(self.structure_version(), 0)

	def test_stale_move_returns_a_structure_conflict(self):
		self.create()
		order_before = get_cr_page(self.cr.name, self.key)["order_index"]

		result = self.move(base=0)

		self.assertFalse(result["ok"])
		self.assertEqual(result["error"], "structure_conflict")
		self.assertEqual(get_cr_page(self.cr.name, self.key)["order_index"], order_before)

	def test_move_on_the_current_tree_applies(self):
		self.create()
		self.assertTrue(self.move(base=self.structure_version())["ok"])

	def test_a_batch_bumps_the_structure_version_once(self):
		result = apply_cr_operations(
			self.cr.name,
			operations=[
				{"type": "create_node", "temp_key": "a", "parent_key": self.root_key, "title": "A"},
				{"type": "create_node", "temp_key": "b", "parent_key": self.root_key, "title": "B"},
				{"type": "delete_node", "doc_key": self.other_key},
			],
		)
		self.assertEqual(result["structure_version"], 1)
		self.assertEqual(self.structure_version(), 1)

	def test_content_and_rename_leave_the_structure_version_alone(self):
		saved = self.save("Next.")
		renamed = apply_cr_operations(
			self.cr.name,
			operations=[{"type": "update_node", "doc_key": self.key, "fields": {"title": "Renamed"}}],
		)
		self.assertNotIn("structure_version", saved)
		self.assertNotIn("structure_version", renamed)
		self.assertEqual(self.structure_version(), 0)

	def test_older_endpoints_bump_the_structure_version(self):
		create_cr_page(self.cr.name, self.root_key, "Older")
		move_cr_page(self.cr.name, self.key, self.root_key, 0)
		reorder_cr_children(self.cr.name, self.root_key, [self.key, self.other_key])
		delete_cr_page(self.cr.name, self.other_key)
		restore_cr_page(self.cr.name, self.other_key)
		self.assertEqual(self.structure_version(), 5)

	def test_base_version_still_guards_the_whole_draft(self):
		self.save("From B.")
		result = apply_cr_operations(
			self.cr.name,
			base_version=0,
			operations=[{"type": "update_content", "doc_key": self.other_key, "content": "From A."}],
		)
		self.assertEqual(result["error"], "version_conflict")


class TestBatchAfterALockWait(DraftFixture, WikiFixtureMixin, WikiTestCase):
	def setUp(self):
		if frappe.db.db_type == "sqlite":
			self.skipTest("SQLite has no row locks to wait on")
		super().setUp()

	def test_a_batch_that_read_before_another_save_refuses_to_build_on_it(self):
		"""Waiting on the lock does not refresh the snapshot, so plain reads would miss the other save."""
		space = self.wiki.space(pages=[{"title": "Page", "content": "Start."}])
		self.cr = create_change_request(space.name, "Draft")
		self.key = frappe.db.get_value("Wiki Document", {"parent_wiki_document": space.root_group}, "doc_key")
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		frappe.db.get_value("Wiki Change Request", self.cr.name, "operation_version")

		conf = frappe.conf
		other = get_db(
			socket=conf.db_socket,
			host=conf.db_host,
			port=conf.db_port,
			user=conf.db_user or conf.db_name,
			password=conf.db_password,
			cur_db_name=conf.db_name,
		)
		other.connect()
		try:
			other.sql(
				"update `tabWiki Change Request` set operation_version = operation_version + 1 where name = %s",
				self.cr.name,
			)
			other.commit()
		finally:
			other.close()

		with self.assertRaises(frappe.TimestampMismatchError):
			self.save("From A.", base=sha256("Start."))
