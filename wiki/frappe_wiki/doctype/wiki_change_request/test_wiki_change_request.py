# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.core.doctype.user_permission.test_user_permission import create_user
from frappe.tests.utils import FrappeTestCase

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	archive_change_request,
	check_outdated,
	create_change_request,
	create_cr_page,
	delete_cr_page,
	diff_change_request,
	get_change_request,
	get_cr_tree,
	list_change_requests,
	merge_change_request,
	move_cr_page,
	reorder_cr_children,
	request_review,
	review_action,
	update_change_request,
	update_cr_page,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
	create_revision_from_live_tree,
)


class TestWikiChangeRequest(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_create_change_request_initializes_revisions(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")

		cr = create_change_request(space.name, "CR 1")

		space_doc = frappe.get_doc("Wiki Space", space.name)
		self.assertIsNotNone(space_doc.main_revision)
		self.assertEqual(cr.base_revision, space_doc.main_revision)
		self.assertNotEqual(cr.head_revision, cr.base_revision)

		head_revision = frappe.get_doc("Wiki Revision", cr.head_revision)
		self.assertEqual(head_revision.is_working, 1)

		item_count = frappe.db.count("Wiki Revision Item", {"revision": cr.head_revision})
		self.assertEqual(item_count, 2)  # root + page

	def test_create_update_page_in_cr(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 2")

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		new_key = create_cr_page(
			cr.name,
			parent_key=root_key,
			title="New Page",
			slug="new-page",
			is_group=0,
			is_published=1,
			content="Hello",
		)

		update_cr_page(cr.name, new_key, {"content": "Hello v2", "title": "New Page v2"})

		item = get_revision_item(cr.head_revision, new_key)
		self.assertEqual(item.title, "New Page v2")
		self.assertEqual(item.is_deleted, 0)
		self.assertIsNotNone(item.content_blob)

	def test_move_reorder_in_cr(self):
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="Page 1")
		page2 = create_test_wiki_document(space.root_group, title="Page 2")
		cr = create_change_request(space.name, "CR 3")

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page1_key = frappe.get_value("Wiki Document", page1.name, "doc_key")
		page2_key = frappe.get_value("Wiki Document", page2.name, "doc_key")

		reorder_cr_children(cr.name, root_key, [page2_key, page1_key])

		item1 = get_revision_item(cr.head_revision, page1_key)
		item2 = get_revision_item(cr.head_revision, page2_key)
		self.assertEqual(item1.order_index, 1)
		self.assertEqual(item2.order_index, 0)

		group_key = create_cr_page(
			cr.name,
			parent_key=root_key,
			title="Group",
			slug="group",
			is_group=1,
			is_published=1,
			content="",
		)

		move_cr_page(cr.name, page1_key, group_key, new_order_index=0)
		item1 = get_revision_item(cr.head_revision, page1_key)
		self.assertEqual(item1.parent_key, group_key)

	def test_merge_without_conflicts_updates_live_tree(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR 4")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2"})

		merge_change_request(cr.name)

		updated = frappe.get_doc("Wiki Document", page.name)
		self.assertEqual(updated.content, "v2")
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Merged")
		self.assertIsNotNone(cr_doc.merge_revision)

	def test_merge_deletes_wiki_document_when_marked_deleted(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page to Delete", content="content")
		page_name = page.name
		cr = create_change_request(space.name, "CR Delete")

		page_key = frappe.get_value("Wiki Document", page_name, "doc_key")

		# Verify the page exists before merge
		self.assertTrue(frappe.db.exists("Wiki Document", page_name))

		# Mark the page as deleted in the change request
		delete_cr_page(cr.name, page_key)

		# Merge the change request
		merge_change_request(cr.name)

		# Verify the page has been deleted from the live tree
		self.assertFalse(frappe.db.exists("Wiki Document", page_name))

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Merged")

	def test_merge_conflict_content_creates_conflict(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR 5")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "cr-change"})

		# Update live content and advance main revision
		page.content = "main-change"
		page.save()
		new_main = create_revision_from_live_tree(space.name, message="main update")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		with self.assertRaises(frappe.ValidationError):
			merge_change_request(cr.name)

		conflict_count = frappe.db.count("Wiki Merge Conflict", {"change_request": cr.name})
		self.assertGreater(conflict_count, 0)

	def test_check_outdated_sets_flag(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 6")

		new_main = create_revision_from_live_tree(space.name, message="main update")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		check_outdated(cr.name)
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.outdated, 1)

	def test_delete_cr_page_marks_deleted(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 7")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		delete_cr_page(cr.name, page_key)

		item = get_revision_item(cr.head_revision, page_key)
		self.assertEqual(item.is_deleted, 1)

	def test_delete_cr_page_marks_descendants_deleted(self):
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		child = create_test_wiki_document(group.name, title="Child")
		cr = create_change_request(space.name, "CR 9")

		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")
		child_key = frappe.get_value("Wiki Document", child.name, "doc_key")
		delete_cr_page(cr.name, group_key)

		group_item = get_revision_item(cr.head_revision, group_key)
		child_item = get_revision_item(cr.head_revision, child_key)
		self.assertEqual(group_item.is_deleted, 1)
		self.assertEqual(child_item.is_deleted, 1)

	def test_diff_summary_returns_changed_pages(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR 8")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2"})

		summary = diff_change_request(cr.name, scope="summary")
		changed_keys = {row["doc_key"] for row in summary}
		self.assertIn(page_key, changed_keys)

	def test_request_review_sets_status_and_reviewers(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 10")

		reviewer1 = create_user("reviewer1@example.com")
		reviewer2 = create_user("reviewer2@example.com")

		request_review(cr.name, [reviewer1.name, reviewer2.name])

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "In Review")
		self.assertEqual(len(cr_doc.reviewers), 2)
		self.assertTrue(all(row.status == "Requested" for row in cr_doc.reviewers))

	def test_review_action_updates_cr_status(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 11")

		reviewer1 = create_user("reviewer3@example.com")
		reviewer2 = create_user("reviewer4@example.com")

		request_review(cr.name, [reviewer1.name, reviewer2.name])

		review_action(cr.name, reviewer1.name, "Approved", comment="LGTM")
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "In Review")

		review_action(cr.name, reviewer2.name, "Changes Requested", comment="Needs work")
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Changes Requested")

		review_action(cr.name, reviewer2.name, "Approved", comment="Fixed")
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Approved")

	def test_review_action_requires_reviewer_or_manager(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 11a")

		reviewer = create_user("reviewer-role@example.com", "Wiki Approver")
		other = create_user("reviewer-other@example.com", "Wiki User")

		request_review(cr.name, [reviewer.name])

		frappe.set_user(other.name)
		with self.assertRaises(frappe.PermissionError):
			review_action(cr.name, reviewer.name, "Approved")

		frappe.set_user(reviewer.name)
		review_action(cr.name, reviewer.name, "Approved")
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Approved")
		frappe.set_user("Administrator")

	def test_merge_content_non_overlapping_changes(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="line1\nline2\nline3\n")
		cr = create_change_request(space.name, "CR 12")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "line1-cr\nline2\nline3\n"})

		page.content = "line1\nline2\nline3-main\n"
		page.save()
		new_main = create_revision_from_live_tree(space.name, message="main update")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		merge_change_request(cr.name)

		updated = frappe.get_doc("Wiki Document", page.name)
		self.assertEqual(updated.content, "line1-cr\nline2\nline3-main\n")

	def test_merge_requires_manager_or_approver(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR 12a")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2"})

		manager = create_user("merge-manager@example.com", "Wiki Manager")
		user = create_user("merge-no-access@example.com", "Wiki User")
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			merge_change_request(cr.name)

		frappe.set_user(manager.name)
		merge_change_request(cr.name)
		frappe.set_user("Administrator")

	def test_get_cr_tree_returns_children(self):
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="Page A")
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		child = create_test_wiki_document(group.name, title="Child")
		cr = create_change_request(space.name, "CR 13")

		tree = get_cr_tree(cr.name)

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page1_key = frappe.get_value("Wiki Document", page1.name, "doc_key")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")
		child_key = frappe.get_value("Wiki Document", child.name, "doc_key")

		self.assertEqual(tree.get("root_group"), root_key)
		children = tree.get("children") or []
		child_keys = {node["doc_key"] for node in children}
		self.assertSetEqual(child_keys, {page1_key, group_key})

		group_node = next(node for node in children if node["doc_key"] == group_key)
		grandchild_keys = {node["doc_key"] for node in group_node.get("children") or []}
		self.assertSetEqual(grandchild_keys, {child_key})

	def test_list_change_requests_filters_by_status(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr1 = create_change_request(space.name, "CR 14")
		cr2 = create_change_request(space.name, "CR 15")
		frappe.db.set_value("Wiki Change Request", cr2.name, "status", "In Review")

		entries = list_change_requests(space.name, status="In Review")
		names = {entry.get("name") for entry in entries}
		self.assertSetEqual(names, {cr2.name})
		self.assertNotIn(cr1.name, names)

	def test_update_change_request_updates_fields(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 16")

		update_change_request(cr.name, title="New Title", description="New Desc")
		updated = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(updated.title, "New Title")
		self.assertEqual(updated.description, "New Desc")

	def test_get_change_request_returns_dict(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 17")

		data = get_change_request(cr.name)
		self.assertEqual(data.get("name"), cr.name)
		self.assertEqual(data.get("title"), cr.title)

	def test_merge_preserves_existing_routes(self):
		"""Merging a CR must not regenerate routes for existing documents.
		Routes are permalinks — they should remain stable across merges."""
		space = create_test_wiki_space()

		# Build a small tree with a group and two child pages
		group = create_test_wiki_document(space.root_group, title="Introduction", is_group=1)
		page_a = create_test_wiki_document(group.name, title="Getting Started")
		page_b = create_test_wiki_document(group.name, title="Installation")

		# Record routes before CR merge
		routes_before = {}
		for doc in (group, page_a, page_b):
			doc.reload()
			self.assertTrue(doc.route, f"{doc.title} should have a route")
			routes_before[doc.name] = doc.route

		# Create a change request that only edits content (no structural changes)
		cr = create_change_request(space.name, "Content update")
		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")
		update_cr_page(cr.name, page_a_key, {"content": "Updated content"})

		# Merge — this used to set doc.route = None for every document,
		# forcing regeneration and triggering duplicate-route errors.
		merge_change_request(cr.name)

		# Verify routes are unchanged
		for doc_name, old_route in routes_before.items():
			current_route = frappe.db.get_value("Wiki Document", doc_name, "route")
			self.assertEqual(
				current_route,
				old_route,
				f"Route of {doc_name} changed after CR merge: {old_route!r} -> {current_route!r}",
			)

	def test_archive_change_request_sets_status(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 18")

		archive_change_request(cr.name)
		archived = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(archived.status, "Archived")
		self.assertIsNotNone(archived.archived_at)


# Helpers


def create_test_wiki_space():
	root_group = frappe.new_doc("Wiki Document")
	root_group.title = f"Root {frappe.generate_hash(length=6)}"
	root_group.is_group = 1
	root_group.insert()

	space = frappe.new_doc("Wiki Space")
	space.space_name = "Test Space"
	space.route = f"test-space-{frappe.generate_hash(length=6)}"
	space.root_group = root_group.name
	space.insert()

	return space


def create_test_wiki_document(parent, title="Test Page", content="Content", is_group: int = 0):
	doc = frappe.new_doc("Wiki Document")
	doc.title = title
	doc.content = content
	doc.parent_wiki_document = parent
	doc.is_group = 1 if is_group else 0
	doc.is_published = 1
	doc.insert()
	return doc


def get_revision_item(revision, doc_key):
	return frappe.get_doc(
		"Wiki Revision Item",
		frappe.get_value(
			"Wiki Revision Item",
			{"revision": revision, "doc_key": doc_key},
			"name",
		),
	)
