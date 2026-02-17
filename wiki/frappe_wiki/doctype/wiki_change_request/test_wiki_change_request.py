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
	get_or_create_draft_change_request,
	list_change_requests,
	merge_change_request,
	merge_content_three_way,
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

		merge_change_request(cr.name)

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
		result, conflict = merge_content_three_way(base, ours, theirs)
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

		merge_change_request(cr.name)

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

		merge_change_request(cr.name)

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

		merge_change_request(cr.name)

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

		merge_change_request(cr.name)

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
		merge_change_request(cr_init.name)

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
		merge_change_request(cr.name)

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
		merge_change_request(cr_init.name)

		root_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")
		page_key = frappe.get_value("Wiki Document", page.name, "doc_key")
		group_key = frappe.get_value("Wiki Document", group.name, "doc_key")

		# Create a CR that reparents the page to root and deletes the group
		cr = create_change_request(space.name, "Reparent + delete")
		move_cr_page(cr.name, page_key, new_parent_key=root_key)
		delete_cr_page(cr.name, group_key)

		# This should NOT raise NestedSetChildExistsError
		merge_change_request(cr.name)

		page.reload()
		self.assertEqual(page.parent_wiki_document, space.root_group)
		self.assertFalse(frappe.db.exists("Wiki Document", group.name))


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
