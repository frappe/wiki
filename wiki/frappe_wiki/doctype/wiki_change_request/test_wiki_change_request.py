# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.core.doctype.user_permission.test_user_permission import create_user
from frappe.tests.utils import FrappeTestCase

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	apply_cr_operations,
	approve_change_request,
	archive_change_request,
	check_outdated,
	create_change_request,
	create_cr_page,
	delete_cr_page,
	diff_change_request,
	get_change_request,
	get_cr_page,
	get_cr_tree,
	get_merge_conflicts,
	get_or_create_draft_change_request,
	list_change_requests,
	merge_change_request,
	merge_content_three_way,
	move_cr_page,
	reject_change_request,
	reorder_cr_children,
	request_changes,
	resolve_merge_conflict,
	retry_merge_after_resolution,
	submit_change_request,
	update_change_request,
	update_cr_page,
	withdraw_change_request,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
	create_revision_from_live_tree,
)


def _approve_and_merge(name: str):
	"""Force a CR to Approved, then merge — for tests that exercise the merge
	machinery directly without walking the full submit → approve flow.

	Merge now requires an Approved status (see the review-flow revamp), so the
	status is stamped first. The permission/conflict checks inside
	`merge_change_request` still run as the current session user.
	"""
	frappe.db.set_value("Wiki Change Request", name, "status", "Approved")
	return merge_change_request(name)


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
		self.assertEqual(head_revision.is_overlay, 1)

		# Overlay has 0 items (inherits from base)
		overlay_count = frappe.db.count("Wiki Revision Item", {"revision": cr.head_revision})
		self.assertEqual(overlay_count, 0)

		# But the effective tree has all items (root + page)
		from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import get_effective_revision_item_map

		effective = get_effective_revision_item_map(cr.head_revision)
		self.assertEqual(len(effective), 2)

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

	def test_update_cr_page_normalizes_allowed_fields_and_ignores_none(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "CR update fields")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		new_key = create_cr_page(
			cr.name,
			parent_key=root_key,
			title="Original",
			slug="original",
			is_group=1,
			is_published=1,
			content="Original body",
			is_external_link=1,
			external_url="https://example.com/original",
		)

		update_cr_page(
			cr.name,
			new_key,
			{
				"title": "Updated",
				"slug": "updated",
				"route": "custom/updated",
				"is_group": False,
				"is_published": False,
				"is_external_link": False,
				"external_url": "",
				"content": "Updated body",
				"is_deleted": True,
				"revision": "ignored",
			},
		)

		item = get_revision_item(cr.head_revision, new_key)
		self.assertEqual(item.title, "Updated")
		self.assertEqual(item.slug, "updated")
		self.assertEqual(item.route, "custom/updated")
		self.assertEqual(item.is_group, 0)
		self.assertEqual(item.is_published, 0)
		self.assertEqual(item.is_external_link, 0)
		self.assertEqual(item.external_url, "")
		self.assertEqual(item.is_deleted, 1)
		self.assertEqual(item.revision, cr.head_revision)
		self.assertEqual(frappe.get_value("Wiki Content Blob", item.content_blob, "content"), "Updated body")
		content_blob = item.content_blob

		update_cr_page(
			cr.name,
			new_key,
			{
				"title": None,
				"slug": None,
				"route": None,
				"is_group": None,
				"is_published": None,
				"is_external_link": None,
				"external_url": None,
				"content": None,
				"is_deleted": False,
			},
		)

		item.reload()
		self.assertEqual(item.title, "Updated")
		self.assertEqual(item.slug, "updated")
		self.assertEqual(item.route, "custom/updated")
		self.assertEqual(item.is_group, 0)
		self.assertEqual(item.is_published, 0)
		self.assertEqual(item.is_external_link, 0)
		self.assertEqual(item.external_url, "")
		self.assertEqual(item.content_blob, content_blob)
		self.assertEqual(item.is_deleted, 0)

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

	def test_diff_reorder_reports_location_and_position(self):
		"""A reorder is classified as such and carries before/after position so the
		review UI can show a structural move instead of an empty content diff."""
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="Page 1")
		page2 = create_test_wiki_document(space.root_group, title="Page 2")
		cr = create_change_request(space.name, "CR reorder location")

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page1_key = frappe.get_value("Wiki Document", page1.name, "doc_key")
		page2_key = frappe.get_value("Wiki Document", page2.name, "doc_key")

		reorder_cr_children(cr.name, root_key, [page2_key, page1_key])

		summary = diff_change_request(cr.name, scope="summary")
		change_types = {c["doc_key"]: c["change_type"] for c in summary}
		self.assertEqual(change_types.get(page2_key), "reordered")

		page_diff = diff_change_request(cr.name, scope="page", doc_key=page2_key)
		location = page_diff["location"]
		# Page 2 moved from second position to first.
		self.assertEqual(location["base"]["position"], 2)
		self.assertEqual(location["head"]["position"], 1)
		self.assertEqual(location["base"]["total"], 2)
		self.assertIsInstance(location["base"]["path"], list)

	def test_diff_skips_order_index_churn_with_unchanged_position(self):
		"""Reordering renumbers every sibling, but pages that didn't actually move
		(same position) must not show up as spurious 'reordered' changes."""
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="Stay 1")
		page2 = create_test_wiki_document(space.root_group, title="Stay 2")
		cr = create_change_request(space.name, "CR order churn")

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page1_key = frappe.get_value("Wiki Document", page1.name, "doc_key")
		page2_key = frappe.get_value("Wiki Document", page2.name, "doc_key")

		# Keep the same order but force page 2's order_index to a different integer,
		# mimicking the renumbering churn without any real position change.
		reorder_cr_children(cr.name, root_key, [page1_key, page2_key])
		head_item = get_revision_item(cr.head_revision, page2_key)
		frappe.db.set_value("Wiki Revision Item", head_item.name, "order_index", 99)

		summary = diff_change_request(cr.name, scope="summary")
		changed_keys = {c["doc_key"] for c in summary}
		self.assertNotIn(page2_key, changed_keys)
		self.assertNotIn(page1_key, changed_keys)

	def test_merge_without_conflicts_updates_live_tree(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR 4")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2"})

		_approve_and_merge(cr.name)

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
		_approve_and_merge(cr.name)

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
			_approve_and_merge(cr.name)

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

	def _cr_with_change(self, space, cr_title):
		"""Create a CR carrying a single new page so it has real changes to submit."""
		cr = create_change_request(space.name, cr_title)
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		create_cr_page(cr.name, root_key, "New Page", content="hello")
		return cr

	def test_submit_change_request_sets_in_review(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 10")

		submit_change_request(cr.name)

		self.assertEqual(frappe.db.get_value("Wiki Change Request", cr.name, "status"), "In Review")

	def test_submit_change_request_requires_changes(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 10a")

		with self.assertRaises(frappe.ValidationError):
			submit_change_request(cr.name)

	def test_approve_then_merge_self_serve(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11")

		submit_change_request(cr.name)
		approve_change_request(cr.name)

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Approved")
		self.assertEqual(cr_doc.reviewed_by, frappe.session.user)
		self.assertIsNotNone(cr_doc.reviewed_at)

		merge_change_request(cr.name)
		self.assertEqual(frappe.db.get_value("Wiki Change Request", cr.name, "status"), "Merged")

	def test_merge_requires_approved(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11a")

		submit_change_request(cr.name)
		with self.assertRaises(frappe.ValidationError):
			merge_change_request(cr.name)

	def test_in_review_cr_is_locked_for_editing(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11b")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		submit_change_request(cr.name)
		with self.assertRaises(frappe.ValidationError):
			create_cr_page(cr.name, root_key, "Another Page", content="nope")

	def test_approve_requires_write_access(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11c")
		submit_change_request(cr.name)

		non_writer = create_user("cr-non-writer@example.com", "Wiki User")
		frappe.set_user(non_writer.name)
		try:
			with self.assertRaises(frappe.PermissionError):
				approve_change_request(cr.name)
		finally:
			frappe.set_user("Administrator")

	def test_request_changes_sets_status_and_comment(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11d")
		submit_change_request(cr.name)

		request_changes(cr.name, "Please fix the title")

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Changes Requested")
		self.assertEqual(cr_doc.review_comment, "Please fix the title")
		self.assertEqual(cr_doc.reviewed_by, frappe.session.user)

	def test_request_changes_requires_comment(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11e")
		submit_change_request(cr.name)

		with self.assertRaises(frappe.ValidationError):
			request_changes(cr.name, "   ")

	def test_changes_requested_reopens_editing(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11f")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		submit_change_request(cr.name)

		# Locked while In Review ...
		with self.assertRaises(frappe.ValidationError):
			create_cr_page(cr.name, root_key, "Blocked Page", content="no")

		# ... and editable again once changes are requested.
		request_changes(cr.name, "needs work")
		create_cr_page(cr.name, root_key, "Revised Page", content="ok")

	def test_request_changes_requires_write_access(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11g")
		submit_change_request(cr.name)

		non_writer = create_user("cr-rc-non-writer@example.com", "Wiki User")
		frappe.set_user(non_writer.name)
		try:
			with self.assertRaises(frappe.PermissionError):
				request_changes(cr.name, "no access")
		finally:
			frappe.set_user("Administrator")

	def test_reject_sets_terminal_status_and_comment(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11h")
		submit_change_request(cr.name)

		reject_change_request(cr.name, "Out of scope")

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Rejected")
		self.assertEqual(cr_doc.review_comment, "Out of scope")
		self.assertEqual(cr_doc.reviewed_by, frappe.session.user)
		self.assertIsNotNone(cr_doc.reviewed_at)
		self.assertIsNotNone(cr_doc.rejected_at)

	def test_reject_requires_comment(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11i")
		submit_change_request(cr.name)

		with self.assertRaises(frappe.ValidationError):
			reject_change_request(cr.name, "   ")

	def test_reject_is_terminal(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11j")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		submit_change_request(cr.name)
		reject_change_request(cr.name, "no")

		# A rejected CR cannot be edited, resubmitted, or merged.
		with self.assertRaises(frappe.ValidationError):
			create_cr_page(cr.name, root_key, "Page", content="x")
		with self.assertRaises(frappe.ValidationError):
			submit_change_request(cr.name)
		with self.assertRaises(frappe.ValidationError):
			merge_change_request(cr.name)

	def test_reject_requires_write_access(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11k")
		submit_change_request(cr.name)

		non_writer = create_user("cr-reject-non-writer@example.com", "Wiki User")
		frappe.set_user(non_writer.name)
		try:
			with self.assertRaises(frappe.PermissionError):
				reject_change_request(cr.name, "no access")
		finally:
			frappe.set_user("Administrator")

	def test_withdraw_returns_in_review_cr_to_draft(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11l")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		submit_change_request(cr.name)

		# Locked while In Review ...
		with self.assertRaises(frappe.ValidationError):
			create_cr_page(cr.name, root_key, "Blocked", content="no")

		withdraw_change_request(cr.name)

		# ... back to Draft and editable again.
		self.assertEqual(frappe.db.get_value("Wiki Change Request", cr.name, "status"), "Draft")
		create_cr_page(cr.name, root_key, "Revised", content="ok")

	def test_withdraw_requires_in_review(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11m")

		# Draft cannot be withdrawn (nothing to pull back).
		with self.assertRaises(frappe.ValidationError):
			withdraw_change_request(cr.name)

	def test_withdraw_author_or_manager_only(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11n")
		submit_change_request(cr.name)

		other = create_user("cr-withdraw-other@example.com", "Wiki User")
		frappe.set_user(other.name)
		try:
			with self.assertRaises(frappe.PermissionError):
				withdraw_change_request(cr.name)
		finally:
			frappe.set_user("Administrator")

	def test_reviewer_decision_notifies_owner(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11o")
		submit_change_request(cr.name)
		owner = frappe.db.get_value("Wiki Change Request", cr.name, "owner")

		reviewer = create_user("cr-notify-reviewer@example.com", "Wiki Manager")
		frappe.set_user(reviewer.name)
		try:
			approve_change_request(cr.name)
		finally:
			frappe.set_user("Administrator")

		self.assertTrue(
			frappe.db.exists(
				"Notification Log",
				{"for_user": owner, "document_type": "Wiki Change Request", "document_name": cr.name},
			)
		)

	def test_self_serve_decision_does_not_self_notify(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = self._cr_with_change(space, "CR 11p")
		submit_change_request(cr.name)

		# Owner approves their own CR (self-serve) — no notification to self.
		approve_change_request(cr.name)

		self.assertFalse(
			frappe.db.exists(
				"Notification Log",
				{"for_user": frappe.session.user, "document_name": cr.name},
			)
		)

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

		_approve_and_merge(cr.name)

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
			_approve_and_merge(cr.name)

		frappe.set_user(manager.name)
		_approve_and_merge(cr.name)
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
		_approve_and_merge(cr.name)

		# Verify routes are unchanged
		for doc_name, old_route in routes_before.items():
			current_route = frappe.db.get_value("Wiki Document", doc_name, "route")
			self.assertEqual(
				current_route,
				old_route,
				f"Route of {doc_name} changed after CR merge: {old_route!r} -> {current_route!r}",
			)

	def test_desk_edit_syncs_to_revision_system(self):
		"""Phase 1: Editing a Wiki Document via desk should update main_revision."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")

		# Ensure main_revision exists
		from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
			create_revision_from_live_tree,
			get_revision_item_map,
		)

		main_rev = create_revision_from_live_tree(space.name, message="Initial")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", main_rev.name)
		old_main = main_rev.name

		# Edit via desk (direct save)
		page.content = "v2-desk-edit"
		page.save()

		# main_revision should have advanced
		new_main = frappe.db.get_value("Wiki Space", space.name, "main_revision")
		self.assertNotEqual(new_main, old_main, "main_revision should advance after desk edit")

		# The new revision should reflect the desk edit
		items = get_revision_item_map(new_main)
		page_key = frappe.db.get_value("Wiki Document", page.name, "doc_key")
		self.assertIn(page_key, items)

	def test_desk_edit_visible_in_new_cr(self):
		"""Phase 1: A desk edit should be visible when a new CR is created afterwards."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="original")

		from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
			create_revision_from_live_tree,
			get_effective_revision_item_map,
		)

		main_rev = create_revision_from_live_tree(space.name, message="Initial")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", main_rev.name)

		# Desk edit
		page.content = "desk-edit-content"
		page.save()

		# Create a CR after the desk edit
		cr = create_change_request(space.name, "CR after desk edit")

		# The CR's effective tree should contain the desk-edited content
		page_key = frappe.db.get_value("Wiki Document", page.name, "doc_key")
		effective = get_effective_revision_item_map(cr.head_revision)
		item = effective.get(page_key)
		self.assertIsNotNone(item)
		content_blob = item.get("content_blob")
		content = frappe.db.get_value("Wiki Content Blob", content_blob, "content") or ""
		self.assertEqual(content, "desk-edit-content")

	def test_merge_does_not_double_sync(self):
		"""Phase 1: Merging a CR should not re-trigger revision sync via the on_update hook."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR no double sync")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2"})

		_approve_and_merge(cr.name)

		# The merge sets main_revision to the merge_revision.
		# If on_update fired during merge, it would create yet another revision
		# and overwrite main_revision. Verify main_revision == merge_revision.
		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		current_main = frappe.db.get_value("Wiki Space", space.name, "main_revision")
		self.assertEqual(current_main, cr_doc.merge_revision)

	def test_stale_empty_draft_is_auto_archived(self):
		"""Phase 6: An outdated draft with no changes should be archived and replaced."""
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A", content="v1")

		# Create a draft CR (this also initializes main_revision)
		cr = create_change_request(space.name, "Stale Draft")
		old_cr_name = cr.name

		# Advance main_revision so the draft becomes outdated
		new_main = create_revision_from_live_tree(space.name, message="advance main")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		# The draft has no changes (head == base hashes), so it should be archived
		result = get_or_create_draft_change_request(space.name)

		old_cr = frappe.get_doc("Wiki Change Request", old_cr_name)
		self.assertEqual(old_cr.status, "Archived")
		self.assertIsNotNone(old_cr.archived_at)

		# A new CR should have been created
		self.assertNotEqual(result.get("name"), old_cr_name)
		new_cr = frappe.get_doc("Wiki Change Request", result.get("name"))
		self.assertEqual(new_cr.status, "Draft")

	def test_stale_draft_with_changes_is_kept(self):
		"""Phase 6: An outdated draft that has actual changes should NOT be archived."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")

		cr = create_change_request(space.name, "Draft With Changes")
		cr_name = cr.name

		# Make an edit in the CR so it has real changes
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2-from-cr"})

		# Advance main_revision so the draft becomes outdated
		new_main = create_revision_from_live_tree(space.name, message="advance main")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		# The draft has changes, so it should be kept (not archived)
		result = get_or_create_draft_change_request(space.name)

		self.assertEqual(result.get("name"), cr_name)
		kept_cr = frappe.get_doc("Wiki Change Request", cr_name)
		self.assertNotEqual(kept_cr.status, "Archived")
		self.assertEqual(kept_cr.outdated, 1)

	def test_archive_change_request_sets_status(self):
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		cr = create_change_request(space.name, "CR 18")

		archive_change_request(cr.name)
		archived = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(archived.status, "Archived")
		self.assertIsNotNone(archived.archived_at)

	# --- Phase 2: merge_content_three_way unit tests ---

	def test_merge_content_three_way_trivial_cases(self):
		# ours == theirs
		result, conflict = merge_content_three_way("base", "same", "same")
		self.assertFalse(conflict)
		self.assertEqual(result, "same")

		# ours == base (theirs changed)
		result, conflict = merge_content_three_way("base", "base", "theirs")
		self.assertFalse(conflict)
		self.assertEqual(result, "theirs")

		# theirs == base (ours changed)
		result, conflict = merge_content_three_way("base", "ours", "base")
		self.assertFalse(conflict)
		self.assertEqual(result, "ours")

	def test_merge_content_three_way_same_length_lines(self):
		base = "line1\nline2\nline3\n"
		ours = "line1-ours\nline2\nline3\n"
		theirs = "line1\nline2\nline3-theirs\n"
		result, conflict = merge_content_three_way(base, ours, theirs)
		self.assertFalse(conflict)
		self.assertEqual(result, "line1-ours\nline2\nline3-theirs\n")

	def test_merge_content_three_way_different_length_disjoint(self):
		base = "line1\nline2\nline3\n"
		ours = "line1-ours\nline2\nline3\n"
		theirs = "line1\nline2\nline3\nnew-line\n"
		result, conflict = merge_content_three_way(base, ours, theirs)
		self.assertFalse(conflict)
		self.assertIn("line1-ours", result)
		self.assertIn("new-line", result)

	def test_merge_content_three_way_overlapping_conflict(self):
		base = "line1\nline2\nline3\n"
		ours = "line1-ours\nline2\nline3\n"
		theirs = "line1-theirs\nline2\nline3\n"
		_result, conflict = merge_content_three_way(base, ours, theirs)
		self.assertTrue(conflict)

	def test_merge_content_three_way_whitespace_tolerance(self):
		base = "line1\nline2\nline3\n"
		ours = "line1  \nline2\nline3\n"
		theirs = "line1\nline2\nline3-theirs\n"
		result, conflict = merge_content_three_way(base, ours, theirs)
		self.assertFalse(conflict)
		self.assertIn("line3-theirs", result)

	# --- Phase 4: Overlay revision tests ---

	def test_create_cr_creates_empty_overlay(self):
		"""Phase 4: CR creation should produce an overlay revision with 0 items."""
		space = create_test_wiki_space()
		create_test_wiki_document(space.root_group, title="Page A")
		create_test_wiki_document(space.root_group, title="Page B")

		cr = create_change_request(space.name, "CR overlay")

		head_revision = frappe.get_doc("Wiki Revision", cr.head_revision)
		self.assertEqual(head_revision.is_overlay, 1)
		self.assertEqual(head_revision.parent_revision, cr.base_revision)

		# Zero items in the overlay itself
		overlay_item_count = frappe.db.count("Wiki Revision Item", {"revision": cr.head_revision})
		self.assertEqual(overlay_item_count, 0)

		# Base still has all items
		base_item_count = frappe.db.count("Wiki Revision Item", {"revision": cr.base_revision})
		self.assertGreater(base_item_count, 0)

	def test_editing_promotes_item_to_overlay(self):
		"""Phase 4: Editing 1 page should copy-on-write only that item into the overlay."""
		space = create_test_wiki_space()
		page_a = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		create_test_wiki_document(space.root_group, title="Page B", content="other")

		cr = create_change_request(space.name, "CR promote")

		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")
		update_cr_page(cr.name, page_a_key, {"content": "v2"})

		# Only 1 item promoted to overlay
		overlay_count = frappe.db.count("Wiki Revision Item", {"revision": cr.head_revision})
		self.assertEqual(overlay_count, 1)

		# And it's the right one
		overlay_item = frappe.get_all(
			"Wiki Revision Item",
			filters={"revision": cr.head_revision},
			fields=["doc_key"],
		)
		self.assertEqual(overlay_item[0]["doc_key"], page_a_key)

	def test_overlay_tree_shows_all_pages(self):
		"""Phase 4: get_cr_tree should return full tree despite empty overlay."""
		space = create_test_wiki_space()
		page_a = create_test_wiki_document(space.root_group, title="Page A")
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		child = create_test_wiki_document(group.name, title="Child")

		cr = create_change_request(space.name, "CR tree")

		tree = get_cr_tree(cr.name)
		children = tree.get("children") or []

		# Should show all pages even though overlay is empty
		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")
		child_key = frappe.get_value("Wiki Document", child.name, "doc_key")

		child_keys = {node["doc_key"] for node in children}
		self.assertSetEqual(child_keys, {page_a_key, group_key})

		group_node = next(n for n in children if n["doc_key"] == group_key)
		grandchild_keys = {n["doc_key"] for n in group_node.get("children") or []}
		self.assertSetEqual(grandchild_keys, {child_key})

	def test_overlay_diff_shows_only_changes(self):
		"""Phase 4: diff_change_request should only show edited pages."""
		space = create_test_wiki_space()
		page_a = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		create_test_wiki_document(space.root_group, title="Page B", content="other")

		cr = create_change_request(space.name, "CR diff")

		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")
		update_cr_page(cr.name, page_a_key, {"content": "v2"})

		summary = diff_change_request(cr.name, scope="summary")
		changed_keys = {row["doc_key"] for row in summary}

		# Only page_a should show as changed
		self.assertEqual(changed_keys, {page_a_key})

	def test_overlay_merge_works(self):
		"""Phase 4: Full merge lifecycle with overlay revisions."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="original")

		cr = create_change_request(space.name, "CR merge overlay")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "updated via cr"})

		_approve_and_merge(cr.name)

		# Live tree should be updated
		updated = frappe.get_doc("Wiki Document", page.name)
		self.assertEqual(updated.content, "updated via cr")

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Merged")
		self.assertIsNotNone(cr_doc.merge_revision)

	# --- Phase 5: Optimized merge tests ---

	def test_fast_forward_merge_only_updates_changed_docs(self):
		"""Phase 5: Fast-forward merge only touches documents that changed."""
		space = create_test_wiki_space()
		pages = []
		for i in range(5):
			pages.append(
				create_test_wiki_document(space.root_group, title=f"Page {i}", content=f"content-{i}")
			)

		cr = create_change_request(space.name, "CR fast-forward")

		# Only edit page 2
		target_key = frappe.get_value("Wiki Document", pages[2].name, "doc_key")
		update_cr_page(cr.name, target_key, {"content": "updated-content"})

		# Snapshot state before merge
		snapshot = {}
		for page in pages:
			page.reload()
			snapshot[page.name] = {
				"title": page.title,
				"content": page.content,
				"route": page.route,
				"modified": page.modified,
			}

		_approve_and_merge(cr.name)

		# Only page 2 should have new content; others should be completely untouched
		for page in pages:
			page.reload()
			if page.name == pages[2].name:
				self.assertEqual(page.content, "updated-content")
			else:
				self.assertEqual(page.content, snapshot[page.name]["content"])
				self.assertEqual(page.route, snapshot[page.name]["route"])
				self.assertEqual(page.title, snapshot[page.name]["title"])
				self.assertEqual(
					page.modified,
					snapshot[page.name]["modified"],
					f"Unchanged doc '{page.title}' should not have been modified",
				)

	def test_optimized_three_way_merge_produces_correct_result(self):
		"""Phase 5: Three-way merge with concurrent changes produces correct results."""
		space = create_test_wiki_space()
		pages = []
		for i in range(5):
			pages.append(
				create_test_wiki_document(
					space.root_group, title=f"Page {i}", content="line1\nline2\nline3\n"
				)
			)

		cr = create_change_request(space.name, "CR three-way")

		# CR edits page 0
		page0_key = frappe.get_value("Wiki Document", pages[0].name, "doc_key")
		update_cr_page(cr.name, page0_key, {"content": "line1-cr\nline2\nline3\n"})

		# Main edits page 1 (advance main_revision)
		pages[1].content = "page1-main-edit"
		pages[1].save()
		new_main = create_revision_from_live_tree(space.name, message="main update")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		_approve_and_merge(cr.name)

		# Page 0 should have CR's changes
		pages[0].reload()
		self.assertEqual(pages[0].content, "line1-cr\nline2\nline3\n")

		# Page 1 should retain main's changes
		pages[1].reload()
		self.assertEqual(pages[1].content, "page1-main-edit")

		# Pages 2-4 should be untouched
		for i in range(2, 5):
			pages[i].reload()
			self.assertEqual(pages[i].content, "line1\nline2\nline3\n")

	def test_content_only_change_preserves_route(self):
		"""Phase 5: Content-only changes use fast path and don't affect routes."""
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Guide", is_group=1)
		page = create_test_wiki_document(group.name, title="Installation", content="v1")

		page.reload()
		route_before = page.route
		self.assertTrue(route_before)

		cr = create_change_request(space.name, "CR content only")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "v2 - updated content"})

		_approve_and_merge(cr.name)

		page.reload()
		self.assertEqual(page.content, "v2 - updated content")
		self.assertEqual(page.route, route_before, "Route should not change for content-only edit")

	def test_merge_with_orphan_group_in_live_tree(self):
		"""Merge succeeds when live tree has groups not tracked in any revision.

		Reproduces production bug: intermediate group docs inserted directly into
		the live tree (bypassing revisions) caused NestedSetChildExistsError because
		apply_merge_revision tried to delete parents before reparenting children.
		"""
		space = create_test_wiki_space()
		stock = create_test_wiki_document(space.root_group, title="Stock", is_group=1)
		page_a = create_test_wiki_document(stock.name, title="Page A", content="v1")
		page_b = create_test_wiki_document(stock.name, title="Page B", content="v1")

		# Snapshot the tree into main_revision — pages are children of Stock
		cr_init = create_change_request(space.name, "Init")
		_approve_and_merge(cr_init.name)

		# Now insert an intermediate group directly into the live tree (bypassing revisions),
		# and reparent the pages under it — simulating the production data inconsistency.
		orphan_group = frappe.new_doc("Wiki Document")
		orphan_group.title = "Help Articles"
		orphan_group.is_group = 1
		orphan_group.parent_wiki_document = stock.name
		frappe.flags.in_apply_merge_revision = True
		try:
			orphan_group.insert()
		finally:
			frappe.flags.in_apply_merge_revision = False

		# Reparent page_a under the orphan group in the live tree
		page_a.reload()
		page_a.parent_wiki_document = orphan_group.name
		frappe.flags.in_apply_merge_revision = True
		try:
			page_a.save()
		finally:
			frappe.flags.in_apply_merge_revision = False

		# Create a CR that makes a trivial content change — no deletions
		cr = create_change_request(space.name, "Trivial edit")
		page_b_key = frappe.get_value("Wiki Document", page_b.name, "doc_key")
		update_cr_page(cr.name, page_b_key, {"content": "v2"})

		# This should NOT raise NestedSetChildExistsError
		_approve_and_merge(cr.name)

		page_b.reload()
		self.assertEqual(page_b.content, "v2")

	def test_merge_delete_group_with_reparented_children(self):
		"""Merge deletes a group whose children are reparented in the same CR.

		If deletions ran before saves, the parent would still have children attached
		and frappe.delete_doc would raise NestedSetChildExistsError.
		"""
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Old Group", is_group=1)
		page = create_test_wiki_document(group.name, title="Page Under Group", content="v1")

		cr_init = create_change_request(space.name, "Init")
		_approve_and_merge(cr_init.name)

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")

		# Create a CR that reparents the page to root and deletes the group
		cr = create_change_request(space.name, "Reparent + delete")
		move_cr_page(cr.name, page_key, new_parent_key=root_key)
		delete_cr_page(cr.name, group_key)

		# This should NOT raise NestedSetChildExistsError
		_approve_and_merge(cr.name)

		page.reload()
		self.assertEqual(page.parent_wiki_document, space.root_group)
		self.assertFalse(frappe.db.exists("Wiki Document", group.name))

	def test_merge_preserves_sort_order_for_new_docs_with_order_index_zero(self):
		"""Merge must honour order_index=0 from revision when inserting new Wiki Documents.

		Reproduces production bug: set_sort_order_for_new_document treats
		sort_order=0 as "unset" and overrides it with max(sibling sort_order)+1.
		When a CR adds a new page that should be first among siblings
		(order_index=0), the merge creates the Wiki Document with sort_order=0,
		but the validation hook bumps it to the end.

		The public-facing sidebar sorts by sort_order, so the page appears last
		instead of first, while the editor (which reads order_index from the
		revision) shows it correctly in first position.
		"""
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Buying", is_group=1)
		# Create existing sibling pages so there are items with sort_order > 0
		setup_page = create_test_wiki_document(group.name, title="Setup", content="Setup content")
		features_page = create_test_wiki_document(group.name, title="Features", content="Features content")

		# Snapshot into main_revision
		cr_init = create_change_request(space.name, "Init")
		_approve_and_merge(cr_init.name)

		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")

		# Create a CR that adds a new "Introduction" page as the first child
		cr = create_change_request(space.name, "Add Introduction first")
		intro_key = create_cr_page(
			cr.name,
			group_key,
			"Introduction",
			"Intro content",
		)

		# Reorder so Introduction is first (order_index=0)
		setup_key = frappe.get_value("Wiki Document", setup_page.name, "doc_key")
		features_key = frappe.get_value("Wiki Document", features_page.name, "doc_key")
		reorder_cr_children(cr.name, group_key, [intro_key, setup_key, features_key])

		# Verify the CR tree shows correct order
		tree = get_cr_tree(cr.name)
		buying_node = next(n for n in tree["children"] if n["doc_key"] == group_key)
		child_titles = [c["title"] for c in buying_node["children"]]
		self.assertEqual(child_titles, ["Introduction", "Setup", "Features"])

		# Merge the CR
		_approve_and_merge(cr.name)

		# The new Introduction document must have sort_order=0 (first)
		intro_doc_name = frappe.get_value("Wiki Document", {"doc_key": intro_key})
		intro_sort_order = frappe.get_value("Wiki Document", intro_doc_name, "sort_order")
		self.assertEqual(
			intro_sort_order,
			0,
			f"Introduction should have sort_order=0 but got {intro_sort_order}. "
			"set_sort_order_for_new_document likely overrode order_index=0 during merge.",
		)

		# Verify all siblings have correct sort_order matching their order_index
		setup_sort = frappe.get_value("Wiki Document", setup_page.name, "sort_order")
		features_sort = frappe.get_value("Wiki Document", features_page.name, "sort_order")
		self.assertLess(
			intro_sort_order,
			setup_sort,
			"Introduction (order_index=0) should sort before Setup",
		)
		self.assertLess(
			setup_sort,
			features_sort,
			"Setup (order_index=1) should sort before Features",
		)

	def test_merge_reconciles_stale_sort_order(self):
		"""Merge fixes sort_order on unchanged docs that drifted from the revision.

		If a prior merge left sort_order out of sync (e.g. due to the
		set_sort_order_for_new_document override bug), subsequent merges should
		reconcile the mismatch even for items whose order_index didn't change
		between the base and merge revisions.
		"""
		space = create_test_wiki_space()
		page_a = create_test_wiki_document(space.root_group, title="Page A")
		page_b = create_test_wiki_document(space.root_group, title="Page B")

		# Snapshot into main_revision
		cr_init = create_change_request(space.name, "Init")
		_approve_and_merge(cr_init.name)

		# Artificially corrupt sort_order to simulate a prior bug
		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")
		frappe.db.set_value("Wiki Document", page_a.name, "sort_order", 999, update_modified=False)

		# Verify it's now wrong
		self.assertEqual(frappe.get_value("Wiki Document", page_a.name, "sort_order"), 999)

		# Create a trivial CR (content change on page_b only — page_a is "unchanged")
		cr = create_change_request(space.name, "Trivial edit")
		page_b_key = frappe.get_value("Wiki Document", page_b.name, "doc_key")
		update_cr_page(cr.name, page_b_key, {"content": "updated"})

		# Merge — page_a's order_index didn't change between revisions,
		# but the live doc has the wrong sort_order
		_approve_and_merge(cr.name)

		# The reconciliation step should have fixed page_a's sort_order
		page_a.reload()
		actual = page_a.sort_order
		expected = frappe.get_value(
			"Wiki Revision Item",
			{"revision": frappe.get_value("Wiki Space", space.name, "main_revision"), "doc_key": page_a_key},
			"order_index",
		)
		self.assertEqual(
			actual,
			expected,
			f"Page A sort_order={actual} should match revision order_index={expected}. "
			"Merge should reconcile stale sort_order for unchanged items.",
		)

	def test_resolve_conflict_keep_child_of_deleted_parent(self):
		"""Retry merge fails when a kept child's parent was auto-deleted.

		Scenario:
		  - CR deletes a group (cascading to its children).
		  - Main concurrently modifies a child of that group.
		  - During merge: parent auto-deletes (unchanged in main), child
		    conflicts (modified in main vs deleted in CR).
		  - User resolves child conflict as 'ours' (keep).
		  - The kept child still has parent_key pointing to the deleted group,
		    but _apply_merge_changes_only never reparents it → deleting the
		    group raises NestedSetChildExistsError.
		"""
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		page_a = create_test_wiki_document(group.name, title="Page A", content="original-a")
		create_test_wiki_document(group.name, title="Page B", content="original-b")

		# Snapshot into main_revision
		cr_init = create_change_request(space.name, "Init")
		_approve_and_merge(cr_init.name)

		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")
		page_a_key = frappe.get_value("Wiki Document", page_a.name, "doc_key")

		# CR: delete the group (cascades to children)
		cr = create_change_request(space.name, "Delete group")
		delete_cr_page(cr.name, group_key)

		# Advance main: modify page_a so it diverges from base
		page_a.content = "main-modified-a"
		page_a.save()
		new_main = create_revision_from_live_tree(space.name, message="main edit page_a")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		# Merge should detect a conflict on page_a (modified in main, deleted in CR)
		with self.assertRaises(frappe.ValidationError):
			_approve_and_merge(cr.name)

		conflicts = get_merge_conflicts(cr.name)
		page_a_conflicts = [c for c in conflicts if c["doc_key"] == page_a_key]
		self.assertEqual(len(page_a_conflicts), 1)

		# Resolve: keep the main version of page_a ("ours")
		resolve_merge_conflict(page_a_conflicts[0]["name"], "ours")

		# Retry merge — this should succeed, reparenting page_a to root
		retry_merge_after_resolution(cr.name)

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Merged")

		# page_a should still exist with its content preserved
		page_a.reload()
		self.assertEqual(page_a.content, "main-modified-a")
		# page_a must have been reparented away from the deleted group
		self.assertNotEqual(page_a.parent_wiki_document, group.name)

		# group and page_b should be deleted
		self.assertFalse(frappe.db.exists("Wiki Document", group.name))

	def test_resolve_and_retry_merge_end_to_end(self):
		"""Phase 1 tracer bullet: detect conflict, resolve it, retry merge successfully."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Page A", content="v1")
		cr = create_change_request(space.name, "CR conflict resolve")

		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		update_cr_page(cr.name, page_key, {"content": "cr-change"})

		# Advance main so three-way merge is needed
		page.content = "main-change"
		page.save()
		new_main = create_revision_from_live_tree(space.name, message="main update")
		frappe.db.set_value("Wiki Space", space.name, "main_revision", new_main.name)

		# Merge should fail with conflict
		with self.assertRaises(frappe.ValidationError):
			_approve_and_merge(cr.name)

		# get_merge_conflicts should return the conflict
		conflicts = get_merge_conflicts(cr.name)
		self.assertEqual(len(conflicts), 1)
		conflict = conflicts[0]
		self.assertEqual(conflict["doc_key"], page_key)

		# Resolve with "theirs" (CR's version)
		resolve_merge_conflict(conflict["name"], "theirs")

		resolved = frappe.get_doc("Wiki Merge Conflict", conflict["name"])
		self.assertEqual(resolved.status, "Resolved")
		self.assertEqual(resolved.resolution, "theirs")

		# Retry merge
		retry_merge_after_resolution(cr.name)

		cr_doc = frappe.get_doc("Wiki Change Request", cr.name)
		self.assertEqual(cr_doc.status, "Merged")

		page.reload()
		self.assertEqual(page.content, "cr-change")

	def test_route_tracked_through_cr_and_applied_on_merge(self):
		"""Route changes through a CR should be applied to the Wiki Document on merge."""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Routed Page", content="v1")
		page.reload()
		original_route = page.route
		self.assertTrue(original_route, "Page should have a route after creation")

		cr = create_change_request(space.name, "Route update CR")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")

		new_route = f"{space.route}/custom-new-route"
		update_cr_page(cr.name, page_key, {"route": new_route})

		# Verify get_cr_page returns the updated route
		cr_page = get_cr_page(cr.name, page_key)
		self.assertEqual(cr_page["route"], new_route)

		_approve_and_merge(cr.name)

		page.reload()
		self.assertEqual(page.route, new_route)

	def test_merge_preserves_iframe_embed_content(self):
		"""Server-side guarantee: the merge path never mutates iframe HTML.

		Related to frappe/wiki#599. The double-escape symptom reported there
		lives in the TipTap editor round-trip, not in this merge code — but
		this test pins the Python boundary so adding sanitization on either
		side of the blob→document hop can't silently re-introduce the bug.
		"""
		iframe = (
			'<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" '
			'title="YouTube video" frameborder="0"></iframe>'
		)
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Embed Page", content=iframe)
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")

		# First merge cycle: edit via CR, preserve the iframe, merge.
		cr1 = create_change_request(space.name, "Embed CR 1")
		update_cr_page(cr1.name, page_key, {"content": iframe + "\n\nFirst edit."})
		_approve_and_merge(cr1.name)

		page.reload()
		self.assertIn(iframe, page.content)
		self.assertNotIn("&lt;iframe", page.content)

		# Second merge cycle: the compounding used to happen here.
		cr2 = create_change_request(space.name, "Embed CR 2")
		update_cr_page(cr2.name, page_key, {"content": iframe + "\n\nSecond edit."})
		_approve_and_merge(cr2.name)

		page.reload()
		self.assertIn(iframe, page.content)
		self.assertNotIn("&lt;iframe", page.content)
		self.assertNotIn("&amp;lt;", page.content)

	def test_new_draft_page_gets_auto_generated_route(self):
		"""A new page created in a CR should get an auto-generated route from ancestor slugs."""
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Docs", is_group=1)

		cr = create_change_request(space.name, "New page CR")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")

		new_doc_key = create_cr_page(cr.name, group_key, "My New Page")

		# Verify get_cr_page returns a computed route
		cr_page = get_cr_page(cr.name, new_doc_key)
		self.assertTrue(cr_page["route"], "New draft page should have an auto-generated route")
		self.assertIn("my-new-page", cr_page["route"])

		_approve_and_merge(cr.name)

		# Verify the new Wiki Document has the expected route
		new_doc_name = frappe.db.get_value("Wiki Document", {"doc_key": new_doc_key}, "name")
		self.assertTrue(new_doc_name, "New Wiki Document should exist after merge")
		new_doc = frappe.get_doc("Wiki Document", new_doc_name)
		self.assertTrue(new_doc.route, "New Wiki Document should have a route")

	# --- apply_cr_operations -------------------------------------------------------

	def test_apply_cr_operations_create_returns_temp_key_map(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 1")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "tmp-1",
					"parent_key": root_key,
					"title": "Batch Page",
					"content": "Hello batch",
				}
			],
		)

		self.assertTrue(result["ok"])
		self.assertIn("tmp-1", result["temp_key_map"])
		new_key = result["temp_key_map"]["tmp-1"]
		self.assertEqual(result["current_version"], 1)
		self.assertEqual(len(result["items"]), 1)
		self.assertEqual(result["items"][0]["doc_key"], new_key)
		self.assertEqual(result["items"][0]["title"], "Batch Page")
		# create_node carried content, so the canonical item should include it
		self.assertEqual(result["items"][0]["content"], "Hello batch")

	def test_apply_cr_operations_create_then_update_content_for_temp_key(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 2")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "tmp-1",
					"parent_key": root_key,
					"title": "Batched Edit",
				},
				{
					"id": "op-2",
					"type": "update_content",
					"doc_key": "tmp-1",
					"content": "Body written before promotion",
				},
			],
		)

		self.assertTrue(result["ok"])
		new_key = result["temp_key_map"]["tmp-1"]
		page = get_cr_page(cr.name, new_key)
		self.assertEqual(page["content"], "Body written before promotion")

	def test_apply_cr_operations_create_child_under_temp_parent(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 3")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "tmp-parent",
					"parent_key": root_key,
					"title": "Group",
					"is_group": True,
				},
				{
					"id": "op-2",
					"type": "create_node",
					"temp_key": "tmp-child",
					"parent_key": "tmp-parent",
					"title": "Child",
				},
			],
		)

		self.assertTrue(result["ok"])
		parent_key = result["temp_key_map"]["tmp-parent"]
		child_key = result["temp_key_map"]["tmp-child"]
		child_page = get_cr_page(cr.name, child_key)
		self.assertEqual(child_page["parent_key"], parent_key)

	def test_apply_cr_operations_update_node_recomputes_route(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Old Name", content="x")
		cr = create_change_request(space.name, "Batch CR 4")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "update_node",
					"doc_key": page_key,
					"fields": {"title": "Renamed", "slug": "renamed"},
				},
			],
		)

		self.assertTrue(result["ok"])
		self.assertEqual(len(result["items"]), 1)
		item = result["items"][0]
		self.assertEqual(item["title"], "Renamed")
		self.assertEqual(item["slug"], "renamed")
		self.assertIn("renamed", item["route"])

	def test_apply_cr_operations_delete_group_cascades_to_descendants(self):
		space = create_test_wiki_space()
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		child = create_test_wiki_document(group.name, title="Child")
		cr = create_change_request(space.name, "Batch CR 5")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")
		child_key = frappe.get_value("Wiki Document", child.name, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[{"id": "op-1", "type": "delete_node", "doc_key": group_key}],
		)

		self.assertTrue(result["ok"])
		deleted = set(result["deleted_doc_keys"])
		self.assertIn(group_key, deleted)
		self.assertIn(child_key, deleted)

	def test_apply_cr_operations_move_and_reorder_in_one_batch(self):
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="Page 1")
		page2 = create_test_wiki_document(space.root_group, title="Page 2")
		group = create_test_wiki_document(space.root_group, title="Group", is_group=1)
		cr = create_change_request(space.name, "Batch CR 6")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page1_key = frappe.get_value("Wiki Document", page1.name, "doc_key")
		page2_key = frappe.get_value("Wiki Document", page2.name, "doc_key")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "move_node",
					"doc_key": page1_key,
					"target_parent_key": group_key,
				},
				{
					"id": "op-2",
					"type": "reorder_children",
					"parent_key": root_key,
					"ordered_doc_keys": [group_key, page2_key],
				},
			],
		)

		self.assertTrue(result["ok"])
		moved = get_revision_item(cr.head_revision, page1_key)
		self.assertEqual(moved.parent_key, group_key)
		group_item = get_revision_item(cr.head_revision, group_key)
		page2_item = get_revision_item(cr.head_revision, page2_key)
		self.assertEqual(group_item.order_index, 0)
		self.assertEqual(page2_item.order_index, 1)

	def test_apply_cr_operations_unknown_type_rolls_back_batch(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 7")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		before_version = int(frappe.db.get_value("Wiki Change Request", cr.name, "operation_version") or 0)

		with self.assertRaises(frappe.ValidationError):
			apply_cr_operations(
				cr.name,
				base_version=0,
				operations=[
					{
						"id": "op-1",
						"type": "create_node",
						"temp_key": "tmp-1",
						"parent_key": root_key,
						"title": "Should not persist",
					},
					{"id": "op-2", "type": "frobnicate", "doc_key": "x"},
				],
			)

		# Frappe's request transaction would roll back in production; in tests we
		# explicitly roll back so the assertion below is meaningful.
		frappe.db.rollback()

		# No item with that title should exist.
		count = frappe.db.count(
			"Wiki Revision Item",
			{"revision": cr.head_revision, "title": "Should not persist"},
		)
		self.assertEqual(count, 0)
		self.assertEqual(
			int(frappe.db.get_value("Wiki Change Request", cr.name, "operation_version") or 0),
			before_version,
		)

	def test_apply_cr_operations_invalid_doc_key_raises(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 8")

		with self.assertRaises(Exception):
			apply_cr_operations(
				cr.name,
				base_version=0,
				operations=[
					{
						"id": "op-1",
						"type": "update_node",
						"doc_key": "does-not-exist",
						"fields": {"title": "x"},
					}
				],
			)

	def test_apply_cr_operations_increments_operation_version(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 9")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		first = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "t1",
					"parent_key": root_key,
					"title": "A",
				}
			],
		)
		self.assertEqual(first["current_version"], 1)

		second = apply_cr_operations(
			cr.name,
			base_version=1,
			operations=[
				{
					"id": "op-2",
					"type": "create_node",
					"temp_key": "t2",
					"parent_key": root_key,
					"title": "B",
				}
			],
		)
		self.assertEqual(second["current_version"], 2)

	def test_apply_cr_operations_stale_base_version_returns_conflict(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 10")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "t1",
					"parent_key": root_key,
					"title": "First",
				}
			],
		)

		stale = apply_cr_operations(
			cr.name,
			base_version=0,  # client thinks server is still at 0
			operations=[
				{
					"id": "op-2",
					"type": "create_node",
					"temp_key": "t2",
					"parent_key": root_key,
					"title": "Stale",
				}
			],
		)

		self.assertFalse(stale["ok"])
		self.assertEqual(stale["error"], "version_conflict")
		self.assertEqual(stale["current_version"], 1)
		# The stale batch must not have written anything.
		self.assertEqual(
			frappe.db.count(
				"Wiki Revision Item",
				{"revision": cr.head_revision, "title": "Stale"},
			),
			0,
		)

	def test_apply_cr_operations_reads_operation_version_with_for_update(self):
		"""Regression guard: the base_version check must read with `for_update=True`.

		Without the row lock, two concurrent batches against the same
		`base_version` can both pass the `<` check, both call
		`_bump_operation_version`, and end up advancing the counter by 1
		instead of 2 — silently merging operations from two clients that
		each believed they were the only writer. A real concurrency test
		needs two DB connections, so this test only verifies the lock is
		requested in the SQL the endpoint emits.
		"""
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Concurrent CR")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		real_get_value = frappe.db.get_value
		locked_reads = []

		def tracking_get_value(*args, **kwargs):
			doctype = args[0] if args else kwargs.get("doctype")
			filters = args[1] if len(args) > 1 else kwargs.get("filters")
			fieldname = args[2] if len(args) > 2 else kwargs.get("fieldname")
			if (
				doctype == "Wiki Change Request"
				and filters == cr.name
				and fieldname == "operation_version"
				and kwargs.get("for_update")
			):
				locked_reads.append(True)
			return real_get_value(*args, **kwargs)

		frappe.db.get_value = tracking_get_value
		try:
			result = apply_cr_operations(
				cr.name,
				base_version=0,
				operations=[
					{
						"id": "op-1",
						"type": "create_node",
						"temp_key": "t1",
						"parent_key": root_key,
						"title": "Page",
					}
				],
			)
		finally:
			frappe.db.get_value = real_get_value

		self.assertTrue(result["ok"])
		self.assertTrue(
			locked_reads,
			"apply_cr_operations must read operation_version with for_update=True",
		)

	def test_legacy_mutators_lock_cr_row_for_update(self):
		"""Regression guard for the legacy/batch rollout race.

		During rollout the old per-action RPCs (`create_cr_page`,
		`update_cr_page`, `delete_cr_page`, `move_cr_page`,
		`reorder_cr_children`) still bump `operation_version`. If they
		read the version without `for_update=True`, a concurrent batch on
		the same CR can both pass the conflict check and both write the
		same `+1`. Each legacy endpoint must therefore go through
		`_lock_and_load_cr`.
		"""
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Legacy Lock CR")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		real_get_value = frappe.db.get_value
		seen: dict[str, bool] = {}
		current_call: dict[str, str] = {}

		def tracking_get_value(*args, **kwargs):
			doctype = args[0] if args else kwargs.get("doctype")
			filters = args[1] if len(args) > 1 else kwargs.get("filters")
			fieldname = args[2] if len(args) > 2 else kwargs.get("fieldname")
			if (
				doctype == "Wiki Change Request"
				and filters == cr.name
				and fieldname == "operation_version"
				and kwargs.get("for_update")
				and current_call.get("name")
			):
				seen[current_call["name"]] = True
			return real_get_value(*args, **kwargs)

		def run(label: str, fn):
			current_call["name"] = label
			try:
				fn()
			finally:
				current_call.pop("name", None)

		frappe.db.get_value = tracking_get_value
		try:
			# create
			run(
				"create_cr_page",
				lambda: create_cr_page(
					name=cr.name,
					parent_key=root_key,
					title="Legacy A",
					content="initial",
				),
			)
			created_key = frappe.get_value(
				"Wiki Revision Item",
				{"revision": cr.head_revision, "title": "Legacy A"},
				"doc_key",
			)
			self.assertTrue(created_key)

			# update
			run(
				"update_cr_page",
				lambda: update_cr_page(name=cr.name, doc_key=created_key, fields={"title": "Legacy A2"}),
			)

			# move (move into self-as-parent is forbidden; move to root again is fine)
			run(
				"move_cr_page",
				lambda: move_cr_page(
					name=cr.name,
					doc_key=created_key,
					new_parent_key=root_key,
					new_order_index=0,
				),
			)

			# reorder (single-child reorder is a valid no-op signal)
			run(
				"reorder_cr_children",
				lambda: reorder_cr_children(
					name=cr.name, parent_key=root_key, ordered_doc_keys=[created_key]
				),
			)

			# delete (last so it doesn't break the earlier ops)
			run(
				"delete_cr_page",
				lambda: delete_cr_page(name=cr.name, doc_key=created_key),
			)
		finally:
			frappe.db.get_value = real_get_value

		for endpoint in (
			"create_cr_page",
			"update_cr_page",
			"move_cr_page",
			"reorder_cr_children",
			"delete_cr_page",
		):
			self.assertTrue(
				seen.get(endpoint),
				f"{endpoint} must load the CR via _lock_and_load_cr (for_update=True)",
			)

	def test_apply_cr_operations_null_base_version_accepted(self):
		"""During rollout, older clients send no base_version; backend should accept."""
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 11")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		# Bump version once via a normal call.
		apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "t1",
					"parent_key": root_key,
					"title": "First",
				}
			],
		)

		result = apply_cr_operations(
			cr.name,
			base_version=None,
			operations=[
				{
					"id": "op-2",
					"type": "create_node",
					"temp_key": "t2",
					"parent_key": root_key,
					"title": "Second",
				}
			],
		)
		self.assertTrue(result["ok"])
		self.assertEqual(result["current_version"], 2)

	def test_apply_cr_operations_accepts_json_string_input(self):
		"""Frappe's RPC layer can pass `operations` as a JSON string; endpoint must parse."""
		import json

		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Batch CR 12")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		result = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=json.dumps(
				[
					{
						"id": "op-1",
						"type": "create_node",
						"temp_key": "t1",
						"parent_key": root_key,
						"title": "From JSON",
					}
				]
			),
		)
		self.assertTrue(result["ok"])
		self.assertIn("t1", result["temp_key_map"])

	def test_legacy_create_cr_page_bumps_operation_version(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Legacy bump CR 1")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

		create_cr_page(cr.name, root_key, "Legacy", content="x")

		self.assertEqual(
			int(frappe.db.get_value("Wiki Change Request", cr.name, "operation_version") or 0),
			1,
		)

	def test_legacy_update_move_reorder_delete_each_bump_version(self):
		space = create_test_wiki_space()
		page1 = create_test_wiki_document(space.root_group, title="P1")
		page2 = create_test_wiki_document(space.root_group, title="P2")
		group = create_test_wiki_document(space.root_group, title="G", is_group=1)
		cr = create_change_request(space.name, "Legacy bump CR 2")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		p1 = frappe.get_value("Wiki Document", page1.name, "doc_key")
		p2 = frappe.get_value("Wiki Document", page2.name, "doc_key")
		g = frappe.get_value("Wiki Document", group.name, "doc_key")

		def current():
			return int(frappe.db.get_value("Wiki Change Request", cr.name, "operation_version") or 0)

		self.assertEqual(current(), 0)
		update_cr_page(cr.name, p1, {"title": "P1 updated"})
		self.assertEqual(current(), 1)
		move_cr_page(cr.name, p1, g)
		self.assertEqual(current(), 2)
		reorder_cr_children(cr.name, root_key, [g, p2])
		self.assertEqual(current(), 3)
		delete_cr_page(cr.name, p2)
		self.assertEqual(current(), 4)

	def test_legacy_mutation_between_batches_advances_base_version(self):
		"""Mixed-mode: a legacy RPC between two batches must move the version
		so the second batch sends the bumped value as base_version.
		"""
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Mixed", content="x")
		cr = create_change_request(space.name, "Mixed mode CR")
		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")

		first = apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "t1",
					"parent_key": root_key,
					"title": "Batch 1",
				}
			],
		)
		self.assertEqual(first["current_version"], 1)

		# Legacy mutation sneaks in.
		update_cr_page(cr.name, page_key, {"title": "Legacy rename"})
		self.assertEqual(
			int(frappe.db.get_value("Wiki Change Request", cr.name, "operation_version") or 0),
			2,
		)

		# A batch sent with base_version=1 (what the client knew before legacy
		# write) must now be flagged as a conflict instead of clobbering.
		stale = apply_cr_operations(
			cr.name,
			base_version=1,
			operations=[
				{
					"id": "op-2",
					"type": "create_node",
					"temp_key": "t2",
					"parent_key": root_key,
					"title": "Batch 2 stale",
				}
			],
		)
		self.assertFalse(stale["ok"])
		self.assertEqual(stale["error"], "version_conflict")
		self.assertEqual(stale["current_version"], 2)

	def test_get_cr_tree_returns_operation_version(self):
		space = create_test_wiki_space()
		cr = create_change_request(space.name, "Tree version CR")
		tree = get_cr_tree(cr.name)
		self.assertEqual(tree.get("operation_version"), 0)

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		apply_cr_operations(
			cr.name,
			base_version=0,
			operations=[
				{
					"id": "op-1",
					"type": "create_node",
					"temp_key": "t1",
					"parent_key": root_key,
					"title": "Bumps version",
				}
			],
		)
		tree2 = get_cr_tree(cr.name)
		self.assertEqual(tree2.get("operation_version"), 1)


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
