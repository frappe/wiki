# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import json

import frappe
from frappe.tests.utils import FrappeTestCase


class TestReorderWikiDocumentsAPI(FrappeTestCase):
	"""Tests for the reorder_wiki_documents API."""

	def setUp(self):
		# Always start as Administrator
		frappe.set_user("Administrator")

	def tearDown(self):
		# Reset to Administrator before rollback
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_direct_reorder_as_manager(self):
		"""Test direct reorder when user has write permission."""
		space = create_test_wiki_space()

		# Create multiple pages
		page1 = create_wiki_document(space.root_group, "Page 1")
		page2 = create_wiki_document(space.root_group, "Page 2")
		page3 = create_wiki_document(space.root_group, "Page 3")

		# Set as administrator (has write permission)
		frappe.set_user("Administrator")

		# Reorder - move page3 to first position
		from wiki.api.wiki_space import reorder_wiki_documents

		siblings = json.dumps([page3.name, page1.name, page2.name])
		result = reorder_wiki_documents(
			doc_name=page3.name,
			new_parent=space.root_group,
			new_index=0,
			siblings=siblings,
		)

		# Direct reorder returns is_contribution: False
		self.assertFalse(result.get("is_contribution"))

		# Verify sort orders were updated
		page1.reload()
		page2.reload()
		page3.reload()

		self.assertEqual(page3.sort_order, 0)
		self.assertEqual(page1.sort_order, 1)
		self.assertEqual(page2.sort_order, 2)

	def test_reorder_persists_after_get_wiki_tree(self):
		"""Test that reorder persists when fetched via get_wiki_tree (simulates page refresh).

		This test replicates the bug where:
		1. reorder_wiki_documents is called
		2. get_wiki_tree returns correct order immediately after
		3. After page refresh (another get_wiki_tree call), order reverts
		"""
		from wiki.api.wiki_space import get_wiki_tree, reorder_wiki_documents

		space = create_test_wiki_space()

		# Create pages - they will have default sort_order (likely 0 or null)
		intro = create_wiki_document(space.root_group, "Introduction")
		q1 = create_wiki_document(space.root_group, "Q1", is_group=True)
		q2 = create_wiki_document(space.root_group, "Q2", is_group=True)
		q3 = create_wiki_document(space.root_group, "Q3", is_group=True)
		q4 = create_wiki_document(space.root_group, "Q4", is_group=True)
		q5 = create_wiki_document(space.root_group, "Q5", is_group=True)
		q6 = create_wiki_document(space.root_group, "Q6", is_group=True)
		license_doc = create_wiki_document(space.root_group, "License")

		# Set initial sort_order where Q6 is BEFORE Q5 (the wrong order)
		frappe.db.set_value("Wiki Document", intro.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", q1.name, "sort_order", 1)
		frappe.db.set_value("Wiki Document", q2.name, "sort_order", 2)
		frappe.db.set_value("Wiki Document", q3.name, "sort_order", 3)
		frappe.db.set_value("Wiki Document", q4.name, "sort_order", 4)
		frappe.db.set_value("Wiki Document", q6.name, "sort_order", 5)  # Q6 before Q5 - WRONG
		frappe.db.set_value("Wiki Document", q5.name, "sort_order", 6)  # Q5 after Q6 - WRONG
		frappe.db.set_value("Wiki Document", license_doc.name, "sort_order", 7)

		frappe.set_user("Administrator")

		# Verify initial wrong order via get_wiki_tree
		tree_before = get_wiki_tree(space.name)
		children_before = tree_before["children"]
		titles_before = [c["title"] for c in children_before]
		self.assertEqual(titles_before, ["Introduction", "Q1", "Q2", "Q3", "Q4", "Q6", "Q5", "License"])

		# Now reorder - move Q6 to position 6 (after Q5), fixing the order
		# New correct order: intro, q1, q2, q3, q4, q5, q6, license
		new_siblings = [intro.name, q1.name, q2.name, q3.name, q4.name, q5.name, q6.name, license_doc.name]
		result = reorder_wiki_documents(
			doc_name=q6.name,
			new_parent=space.root_group,
			new_index=6,
			siblings=json.dumps(new_siblings),
		)
		self.assertFalse(result.get("is_contribution"))

		# Immediately check via get_wiki_tree (like frontend does after reorder)
		tree_after = get_wiki_tree(space.name)
		children_after = tree_after["children"]
		titles_after = [c["title"] for c in children_after]

		# This should show correct order
		self.assertEqual(
			titles_after,
			["Introduction", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "License"],
			"Order should be correct immediately after reorder",
		)

		# Verify sort_order values in the response
		sort_orders_after = {c["title"]: c["sort_order"] for c in children_after}
		self.assertEqual(sort_orders_after["Q5"], 5)
		self.assertEqual(sort_orders_after["Q6"], 6)

		# Now simulate a "page refresh" - clear all caches and call get_wiki_tree again
		frappe.clear_cache()

		tree_refresh = get_wiki_tree(space.name)
		children_refresh = tree_refresh["children"]
		titles_refresh = [c["title"] for c in children_refresh]

		# This is where the bug manifests - order might revert after cache clear
		self.assertEqual(
			titles_refresh,
			["Introduction", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "License"],
			"Order should persist after cache clear (simulating page refresh)",
		)

		# Also verify via direct DB query to see actual persisted values
		db_sort_orders = {
			row[0]: row[1]
			for row in frappe.db.sql(
				"""SELECT name, sort_order FROM `tabWiki Document`
				WHERE name IN %s""",
				([q5.name, q6.name],),
			)
		}
		self.assertEqual(db_sort_orders[q5.name], 5, "Q5 sort_order should be 5 in database")
		self.assertEqual(db_sort_orders[q6.name], 6, "Q6 sort_order should be 6 in database")

	def test_reorder_persists_across_transactions(self):
		"""Test that reorder persists across separate database transactions.

		This simulates the real-world scenario where:
		1. User calls reorder_wiki_documents (request 1, transaction 1)
		2. Request completes and commits
		3. User refreshes page, calls get_wiki_tree (request 2, transaction 2)

		The bug: order reverts after step 3.
		"""
		from wiki.api.wiki_space import get_wiki_tree, reorder_wiki_documents

		space = create_test_wiki_space()

		# Create pages
		q5 = create_wiki_document(space.root_group, "Q5", is_group=True)
		q6 = create_wiki_document(space.root_group, "Q6", is_group=True)

		# Set initial sort_order where Q6 is BEFORE Q5 (the wrong order)
		frappe.db.set_value("Wiki Document", q6.name, "sort_order", 0)  # Q6 first - WRONG
		frappe.db.set_value("Wiki Document", q5.name, "sort_order", 1)  # Q5 second - WRONG

		# Commit to simulate end of "setup" request
		frappe.db.commit()  # nosemgrep

		frappe.set_user("Administrator")

		# === SIMULATE REQUEST 1: Reorder API call ===
		new_siblings = [q5.name, q6.name]  # Correct order: Q5 first, Q6 second
		result = reorder_wiki_documents(
			doc_name=q6.name,
			new_parent=space.root_group,
			new_index=1,
			siblings=json.dumps(new_siblings),
		)
		self.assertFalse(result.get("is_contribution"))

		# Commit to simulate end of request 1 (Frappe auto-commits on POST)
		frappe.db.commit()  # nosemgrep

		# === SIMULATE REQUEST 2: Page refresh - new get_wiki_tree call ===
		# Clear all caches to simulate a fresh request
		frappe.clear_cache()
		frappe.local.document_cache = {}  # Clear document cache

		# Call get_wiki_tree as if it's a new request
		tree = get_wiki_tree(space.name)
		children = tree["children"]
		titles = [c["title"] for c in children]

		self.assertEqual(titles, ["Q5", "Q6"], f"Order should be Q5, Q6 after refresh. Got: {titles}")

		# Verify sort_order values
		sort_orders = {c["title"]: c["sort_order"] for c in children}
		self.assertEqual(sort_orders["Q5"], 0, "Q5 should have sort_order 0")
		self.assertEqual(sort_orders["Q6"], 1, "Q6 should have sort_order 1")

		# Also verify directly from database with a fresh query
		q5_sort = frappe.db.get_value("Wiki Document", q5.name, "sort_order")
		q6_sort = frappe.db.get_value("Wiki Document", q6.name, "sort_order")

		self.assertEqual(q5_sort, 0, f"Q5 sort_order in DB should be 0, got {q5_sort}")
		self.assertEqual(q6_sort, 1, f"Q6 sort_order in DB should be 1, got {q6_sort}")

	def test_reorder_via_frappe_call(self):
		"""Test reorder via frappe.call to simulate HTTP API behavior.

		This tests the API as it would be called from the frontend.
		"""
		from wiki.api.wiki_space import get_wiki_tree

		space = create_test_wiki_space()

		# Create pages
		q5 = create_wiki_document(space.root_group, "Q5", is_group=True)
		q6 = create_wiki_document(space.root_group, "Q6", is_group=True)

		# Set initial wrong order: Q6 before Q5
		frappe.db.set_value("Wiki Document", q6.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", q5.name, "sort_order", 1)
		frappe.db.commit()  # nosemgrep

		frappe.set_user("Administrator")

		# Call reorder via frappe.call (simulates HTTP API call)
		result = frappe.call(
			"wiki.api.wiki_space.reorder_wiki_documents",
			doc_name=q6.name,
			new_parent=space.root_group,
			new_index=1,
			siblings=json.dumps([q5.name, q6.name]),  # Correct order
		)
		self.assertFalse(result.get("is_contribution"))

		# Commit like Frappe would at end of request
		frappe.db.commit()  # nosemgrep

		# Clear everything to simulate new request
		frappe.clear_cache()
		if hasattr(frappe.local, "document_cache"):
			frappe.local.document_cache = {}

		# Call get_wiki_tree via frappe.call
		tree = frappe.call(
			"wiki.api.wiki_space.get_wiki_tree",
			space_id=space.name,
		)

		children = tree["children"]
		titles = [c["title"] for c in children]

		self.assertEqual(titles, ["Q5", "Q6"], f"Expected ['Q5', 'Q6'], got {titles}")

		# Check sort_order values in response
		sort_orders = {c["title"]: c["sort_order"] for c in children}
		self.assertEqual(sort_orders["Q5"], 0)
		self.assertEqual(sort_orders["Q6"], 1)

	def test_reorder_preserves_routes(self):
		"""Routes must never change during reorder — neither for simple sort-order
		changes nor for reparenting.  A page's route is its permalink and must
		remain stable regardless of where it sits in the tree."""
		from wiki.api.wiki_space import reorder_wiki_documents

		space = create_test_wiki_space()

		# Build a small tree:
		#   root_group
		#   ├── group_a          (group)
		#   │   ├── page_1       (leaf)
		#   │   └── page_2       (leaf)
		#   └── group_b          (group)
		group_a = create_wiki_document(space.root_group, "Group A", is_group=True)
		page_1 = create_wiki_document(group_a.name, "Page One")
		page_2 = create_wiki_document(group_a.name, "Page Two")
		group_b = create_wiki_document(space.root_group, "Group B", is_group=True)

		# Record every route before any reorder
		routes_before = {}
		for doc in (group_a, page_1, page_2, group_b):
			doc.reload()
			routes_before[doc.name] = doc.route

		frappe.set_user("Administrator")

		# --- Case 1: simple sort-order swap (no parent change) ---
		# Swap group_a and group_b among the root's children
		siblings = json.dumps([group_b.name, group_a.name])
		reorder_wiki_documents(
			doc_name=group_b.name,
			new_parent=space.root_group,
			new_index=0,
			siblings=siblings,
		)

		for doc_name, old_route in routes_before.items():
			current_route = frappe.db.get_value("Wiki Document", doc_name, "route")
			self.assertEqual(
				current_route,
				old_route,
				f"Route of {doc_name} changed after sort-order reorder: "
				f"{old_route!r} -> {current_route!r}",
			)

		# --- Case 2: reparent page_1 from group_a into group_b ---
		siblings_in_b = json.dumps([page_1.name])
		reorder_wiki_documents(
			doc_name=page_1.name,
			new_parent=group_b.name,
			new_index=0,
			siblings=siblings_in_b,
		)

		for doc_name, old_route in routes_before.items():
			current_route = frappe.db.get_value("Wiki Document", doc_name, "route")
			self.assertEqual(
				current_route,
				old_route,
				f"Route of {doc_name} changed after reparent: " f"{old_route!r} -> {current_route!r}",
			)

	def test_reorder_detailed_debug(self):
		"""Detailed test to trace exactly what happens during reorder.

		This test prints detailed information at each step to help debug
		why the order might not persist.
		"""
		from wiki.api.wiki_space import get_wiki_tree, reorder_wiki_documents

		space = create_test_wiki_space()

		# Create 8 documents like the user's scenario
		intro = create_wiki_document(space.root_group, "Introduction")
		q1 = create_wiki_document(space.root_group, "Q1", is_group=True)
		q2 = create_wiki_document(space.root_group, "Q2", is_group=True)
		q3 = create_wiki_document(space.root_group, "Q3", is_group=True)
		q4 = create_wiki_document(space.root_group, "Q4", is_group=True)
		q5 = create_wiki_document(space.root_group, "Q5", is_group=True)
		q6 = create_wiki_document(space.root_group, "Q6", is_group=True)
		license_doc = create_wiki_document(space.root_group, "License")

		all_docs = [intro, q1, q2, q3, q4, q5, q6, license_doc]
		doc_names = [d.name for d in all_docs]

		# Set initial WRONG order: Q6 at position 5, Q5 at position 6
		initial_order = [intro, q1, q2, q3, q4, q6, q5, license_doc]  # Q6 before Q5
		for idx, doc in enumerate(initial_order):
			frappe.db.set_value("Wiki Document", doc.name, "sort_order", idx)

		frappe.db.commit()  # nosemgrep

		# Step 1: Verify initial state in DB
		print("\n=== STEP 1: Initial DB state ===")
		db_values_before = frappe.db.sql(
			"""SELECT name, title, sort_order FROM `tabWiki Document`
			WHERE name IN %s ORDER BY sort_order""",
			(doc_names,),
			as_dict=True,
		)
		for row in db_values_before:
			print(f"  {row['title']}: sort_order={row['sort_order']}")

		# Verify Q6 is before Q5 initially
		q5_order_before = next(r["sort_order"] for r in db_values_before if r["title"] == "Q5")
		q6_order_before = next(r["sort_order"] for r in db_values_before if r["title"] == "Q6")
		self.assertLess(q6_order_before, q5_order_before, "Initial: Q6 should be before Q5")

		# Step 2: Call get_wiki_tree to see initial order
		print("\n=== STEP 2: Initial get_wiki_tree ===")
		frappe.set_user("Administrator")
		tree_before = get_wiki_tree(space.name)
		titles_before = [c["title"] for c in tree_before["children"]]
		print(f"  Tree order: {titles_before}")
		self.assertEqual(titles_before[5], "Q6", "Initial tree should have Q6 at position 5")
		self.assertEqual(titles_before[6], "Q5", "Initial tree should have Q5 at position 6")

		# Step 3: Call reorder to fix the order (move Q6 to position 6)
		print("\n=== STEP 3: Calling reorder_wiki_documents ===")
		correct_order = [intro.name, q1.name, q2.name, q3.name, q4.name, q5.name, q6.name, license_doc.name]
		print(f"  New siblings order: {[d.title for d in [intro, q1, q2, q3, q4, q5, q6, license_doc]]}")

		result = reorder_wiki_documents(
			doc_name=q6.name,
			new_parent=space.root_group,
			new_index=6,
			siblings=json.dumps(correct_order),
		)
		print(f"  Result: {result}")
		self.assertFalse(result.get("is_contribution"))

		# Step 4: Check DB immediately after reorder (BEFORE commit)
		print("\n=== STEP 4: DB state BEFORE commit ===")
		db_values_after_no_commit = frappe.db.sql(
			"""SELECT name, title, sort_order FROM `tabWiki Document`
			WHERE name IN %s ORDER BY sort_order""",
			(doc_names,),
			as_dict=True,
		)
		for row in db_values_after_no_commit:
			print(f"  {row['title']}: sort_order={row['sort_order']}")

		# Step 5: Commit (simulating end of HTTP request)
		print("\n=== STEP 5: Committing transaction ===")
		frappe.db.commit()  # nosemgrep

		# Step 6: Check DB after commit
		print("\n=== STEP 6: DB state AFTER commit ===")
		db_values_after_commit = frappe.db.sql(
			"""SELECT name, title, sort_order FROM `tabWiki Document`
			WHERE name IN %s ORDER BY sort_order""",
			(doc_names,),
			as_dict=True,
		)
		for row in db_values_after_commit:
			print(f"  {row['title']}: sort_order={row['sort_order']}")

		q5_order_after = next(r["sort_order"] for r in db_values_after_commit if r["title"] == "Q5")
		q6_order_after = next(r["sort_order"] for r in db_values_after_commit if r["title"] == "Q6")
		self.assertEqual(q5_order_after, 5, f"Q5 should have sort_order 5, got {q5_order_after}")
		self.assertEqual(q6_order_after, 6, f"Q6 should have sort_order 6, got {q6_order_after}")

		# Step 7: Clear all caches (simulating page refresh)
		print("\n=== STEP 7: Clearing all caches ===")
		frappe.clear_cache()
		if hasattr(frappe.local, "document_cache"):
			frappe.local.document_cache = {}

		# Step 8: Call get_wiki_tree again (simulating refresh)
		print("\n=== STEP 8: get_wiki_tree after refresh ===")
		tree_after = get_wiki_tree(space.name)
		titles_after = [c["title"] for c in tree_after["children"]]
		sort_orders_after = {c["title"]: c["sort_order"] for c in tree_after["children"]}
		print(f"  Tree order: {titles_after}")
		print(f"  Sort orders: {sort_orders_after}")

		# This is the critical assertion
		self.assertEqual(
			titles_after,
			["Introduction", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "License"],
			f"After refresh, order should be correct. Got: {titles_after}",
		)
		self.assertEqual(
			sort_orders_after["Q5"], 5, f"Q5 sort_order should be 5, got {sort_orders_after['Q5']}"
		)
		self.assertEqual(
			sort_orders_after["Q6"], 6, f"Q6 sort_order should be 6, got {sort_orders_after['Q6']}"
		)


class TestWikiDocumentOrderingE2E(FrappeTestCase):
	"""End-to-end tests for wiki document ordering on both admin and public-facing sides."""

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_new_document_appears_at_bottom(self):
		"""Test that newly created documents appear at the bottom of the list, not the top."""
		from wiki.api.wiki_space import get_wiki_tree

		space = create_test_wiki_space()

		# Create 5 groups with explicit sort_order
		groups = []
		for i in range(1, 6):
			doc = frappe.new_doc("Wiki Document")
			doc.title = f"Q{i}"
			doc.parent_wiki_document = space.root_group
			doc.is_group = 1
			doc.sort_order = i - 1  # Q1=0, Q2=1, Q3=2, Q4=3, Q5=4
			doc.insert()
			groups.append(doc)

		frappe.db.commit()  # nosemgrep

		# Verify initial order via get_wiki_tree (admin API)
		tree = get_wiki_tree(space.name)
		titles = [c["title"] for c in tree["children"]]
		self.assertEqual(
			titles, ["Q1", "Q2", "Q3", "Q4", "Q5"], f"Initial order should be Q1-Q5, got {titles}"
		)

		# Now create a NEW document (Q6) without specifying sort_order
		new_doc = frappe.new_doc("Wiki Document")
		new_doc.title = "Q6"
		new_doc.parent_wiki_document = space.root_group
		new_doc.is_group = 1
		# NOT setting sort_order - this should auto-assign to end
		new_doc.insert()

		frappe.db.commit()  # nosemgrep

		# Check where Q6 appears
		tree_after = get_wiki_tree(space.name)
		titles_after = [c["title"] for c in tree_after["children"]]

		# Q6 SHOULD appear at the end (after Q5), NOT at the beginning
		# This test will FAIL if new documents appear at the top
		self.assertEqual(
			titles_after[-1], "Q6", f"New document Q6 should appear at the END. Got order: {titles_after}"
		)
		self.assertEqual(
			titles_after,
			["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
			f"Full order should be Q1-Q6. Got: {titles_after}",
		)

	def test_order_consistency_between_admin_and_public(self):
		"""Test that document order is consistent between admin API and public-facing tree."""
		from frappe.utils.nestedset import get_descendants_of

		from wiki.api.wiki_space import get_wiki_tree
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import build_nested_wiki_tree

		space = create_test_wiki_space()

		# Create 5 groups with explicit sort_order and child pages
		# (public tree only shows groups with published content)
		groups = []
		for i in range(1, 6):
			group = frappe.new_doc("Wiki Document")
			group.title = f"Q{i}"
			group.parent_wiki_document = space.root_group
			group.is_group = 1
			group.is_published = 1
			group.sort_order = i - 1
			group.insert()
			groups.append(group)

			# Create a child page inside each group (needed for public tree)
			child = frappe.new_doc("Wiki Document")
			child.title = f"Page in Q{i}"
			child.parent_wiki_document = group.name
			child.is_group = 0
			child.is_published = 1
			child.insert()

		frappe.db.commit()  # nosemgrep

		# Get order from admin API
		admin_tree = get_wiki_tree(space.name)
		admin_titles = [c["title"] for c in admin_tree["children"]]

		# Get order from public-facing tree builder
		descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		public_tree = build_nested_wiki_tree(descendants)
		public_titles = [c["title"] for c in public_tree]

		print(f"Admin API order: {admin_titles}")
		print(f"Public tree order: {public_titles}")

		# Both should have the same order
		self.assertEqual(
			admin_titles,
			public_titles,
			f"Admin and public order should match. Admin: {admin_titles}, Public: {public_titles}",
		)

	def test_reorder_affects_public_facing_tree(self):
		"""Test that reordering documents via API changes the public-facing tree order."""
		from frappe.utils.nestedset import get_descendants_of

		from wiki.api.wiki_space import get_wiki_tree, reorder_wiki_documents
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import build_nested_wiki_tree

		space = create_test_wiki_space()

		# Create 5 groups: Q1, Q2, Q3, Q4, Q5 with child pages
		docs = []
		for i in range(1, 6):
			group = frappe.new_doc("Wiki Document")
			group.title = f"Q{i}"
			group.parent_wiki_document = space.root_group
			group.is_group = 1
			group.is_published = 1
			group.sort_order = i - 1
			group.insert()
			docs.append(group)

			# Create child page for public tree visibility
			child = frappe.new_doc("Wiki Document")
			child.title = f"Page in Q{i}"
			child.parent_wiki_document = group.name
			child.is_group = 0
			child.is_published = 1
			child.insert()

		frappe.db.commit()  # nosemgrep

		# Verify initial public-facing order
		descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		public_tree_before = build_nested_wiki_tree(descendants)
		public_titles_before = [c["title"] for c in public_tree_before]
		self.assertEqual(public_titles_before, ["Q1", "Q2", "Q3", "Q4", "Q5"])

		# Reorder: Move Q5 to the first position
		# New order: Q5, Q1, Q2, Q3, Q4
		new_siblings = [docs[4].name, docs[0].name, docs[1].name, docs[2].name, docs[3].name]
		result = reorder_wiki_documents(
			doc_name=docs[4].name,  # Q5
			new_parent=space.root_group,
			new_index=0,
			siblings=json.dumps(new_siblings),
		)
		self.assertFalse(result.get("is_contribution"))

		frappe.db.commit()  # nosemgrep

		# Verify new order in admin API
		admin_tree_after = get_wiki_tree(space.name)
		admin_titles_after = [c["title"] for c in admin_tree_after["children"]]
		self.assertEqual(
			admin_titles_after,
			["Q5", "Q1", "Q2", "Q3", "Q4"],
			f"Admin API should show new order. Got: {admin_titles_after}",
		)

		# Clear cache and verify public-facing tree also changed
		frappe.clear_cache()

		descendants_after = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		public_tree_after = build_nested_wiki_tree(descendants_after)
		public_titles_after = [c["title"] for c in public_tree_after]

		self.assertEqual(
			public_titles_after,
			["Q5", "Q1", "Q2", "Q3", "Q4"],
			f"Public tree should show new order after reorder. Got: {public_titles_after}",
		)

	def test_full_e2e_ordering_workflow(self):
		"""Full end-to-end test simulating real user workflow:
		1. Create space with 5 groups
		2. Verify order on public side
		3. Create new group (should appear at bottom)
		4. Reorder items
		5. Verify public side reflects changes
		"""
		from frappe.utils.nestedset import get_descendants_of

		from wiki.api.wiki_space import get_wiki_tree, reorder_wiki_documents
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import build_nested_wiki_tree

		print("\n=== E2E Test: Full Ordering Workflow ===")

		# Step 1: Create space with 5 groups (with child pages for public visibility)
		print("\nStep 1: Creating space with 5 groups...")
		space = create_test_wiki_space()

		docs = []
		for i in range(1, 6):
			group = frappe.new_doc("Wiki Document")
			group.title = f"Folder{i}"
			group.parent_wiki_document = space.root_group
			group.is_group = 1
			group.is_published = 1
			group.sort_order = i - 1
			group.insert()
			docs.append(group)
			print(f"  Created {group.title} with sort_order={group.sort_order}")

			# Create child page for public tree visibility
			child = frappe.new_doc("Wiki Document")
			child.title = f"Page in Folder{i}"
			child.parent_wiki_document = group.name
			child.is_group = 0
			child.is_published = 1
			child.insert()

		frappe.db.commit()  # nosemgrep

		# Step 2: Verify order on public side
		print("\nStep 2: Verifying public-facing order...")
		descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		public_tree = build_nested_wiki_tree(descendants)
		public_titles = [c["title"] for c in public_tree]
		print(f"  Public order: {public_titles}")
		self.assertEqual(public_titles, ["Folder1", "Folder2", "Folder3", "Folder4", "Folder5"])

		# Step 3: Create new group WITHOUT explicit sort_order
		print("\nStep 3: Creating new Folder6 (should appear at bottom)...")
		new_group = frappe.new_doc("Wiki Document")
		new_group.title = "Folder6"
		new_group.parent_wiki_document = space.root_group
		new_group.is_group = 1
		new_group.is_published = 1
		# NOT setting sort_order - should auto-assign to end
		new_group.insert()
		docs.append(new_group)
		print(f"  Created Folder6 with sort_order={new_group.sort_order}")

		# Create child page for Folder6
		child6 = frappe.new_doc("Wiki Document")
		child6.title = "Page in Folder6"
		child6.parent_wiki_document = new_group.name
		child6.is_group = 0
		child6.is_published = 1
		child6.insert()

		frappe.db.commit()  # nosemgrep

		# Check where Folder6 appears
		admin_tree = get_wiki_tree(space.name)
		admin_titles = [c["title"] for c in admin_tree["children"]]
		print(f"  Admin API order after adding Folder6: {admin_titles}")

		# Verify Folder6 is at the end
		self.assertEqual(
			admin_titles[-1], "Folder6", f"Folder6 should be at the end. Got order: {admin_titles}"
		)

		# Step 4: Reorder - move Folder5 to first position
		print("\nStep 4: Reordering - moving Folder5 to first position...")
		# Get current order from admin
		current_names = [c["name"] for c in admin_tree["children"]]
		# Find Folder5's position and move to front
		folder5_name = next(c["name"] for c in admin_tree["children"] if c["title"] == "Folder5")
		other_names = [n for n in current_names if n != folder5_name]
		new_order = [folder5_name, *other_names]

		result = reorder_wiki_documents(
			doc_name=folder5_name,
			new_parent=space.root_group,
			new_index=0,
			siblings=json.dumps(new_order),
		)
		self.assertFalse(result.get("is_contribution"))
		frappe.db.commit()  # nosemgrep

		# Step 5: Verify public side reflects changes
		print("\nStep 5: Verifying public-facing order after reorder...")
		frappe.clear_cache()

		descendants_after = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
		public_tree_after = build_nested_wiki_tree(descendants_after)
		public_titles_after = [c["title"] for c in public_tree_after]
		print(f"  Public order after reorder: {public_titles_after}")

		# Folder5 should now be first
		self.assertEqual(
			public_titles_after[0],
			"Folder5",
			f"Folder5 should be first after reorder. Got: {public_titles_after}",
		)

		print("\n=== E2E Test Complete ===")

	def test_direct_move_changes_parent(self):
		"""Test that moving a document to a new parent updates the parent."""
		space = create_test_wiki_space()

		# Create a group and a page
		group = create_wiki_document(space.root_group, "Group", is_group=True)
		page = create_wiki_document(space.root_group, "Page to Move")

		frappe.set_user("Administrator")

		from wiki.api.wiki_space import reorder_wiki_documents

		# Move page into the group
		result = reorder_wiki_documents(
			doc_name=page.name,
			new_parent=group.name,
			new_index=0,
			siblings=json.dumps([page.name]),
		)

		# Direct move returns is_contribution: False
		self.assertFalse(result.get("is_contribution"))

		page.reload()
		self.assertEqual(page.parent_wiki_document, group.name)

	def test_reorder_children_within_group(self):
		"""Test reordering children within a group (not at root level)."""
		space = create_test_wiki_space()

		# Create a group with three children
		group = create_wiki_document(space.root_group, "Test Group", is_group=True)
		child1 = create_wiki_document(group.name, "Child 1")
		child2 = create_wiki_document(group.name, "Child 2")
		child3 = create_wiki_document(group.name, "Child 3")

		frappe.set_user("Administrator")

		from wiki.api.wiki_space import reorder_wiki_documents

		# Reorder children: move child3 to first position
		# New order: child3, child1, child2
		siblings = json.dumps([child3.name, child1.name, child2.name])
		result = reorder_wiki_documents(
			doc_name=child3.name,
			new_parent=group.name,
			new_index=0,
			siblings=siblings,
		)

		# Direct reorder returns is_contribution: False
		self.assertFalse(result.get("is_contribution"))

		# Verify sort orders were updated
		child1.reload()
		child2.reload()
		child3.reload()

		self.assertEqual(child3.sort_order, 0)
		self.assertEqual(child1.sort_order, 1)
		self.assertEqual(child2.sort_order, 2)

		# Verify parent wasn't changed
		self.assertEqual(child1.parent_wiki_document, group.name)
		self.assertEqual(child2.parent_wiki_document, group.name)
		self.assertEqual(child3.parent_wiki_document, group.name)


class TestRebuildWikiTree(FrappeTestCase):
	"""Tests for the rebuild_wiki_tree function."""

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_rebuild_respects_sort_order(self):
		"""Test that rebuild_wiki_tree respects sort_order field."""
		space = create_test_wiki_space()

		# Create pages with explicit sort orders (reverse alphabetical)
		page_c = create_wiki_document(space.root_group, "Page C")
		page_b = create_wiki_document(space.root_group, "Page B")
		page_a = create_wiki_document(space.root_group, "Page A")

		# Set sort orders to put them in reverse order
		frappe.db.set_value("Wiki Document", page_c.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", page_b.name, "sort_order", 1)
		frappe.db.set_value("Wiki Document", page_a.name, "sort_order", 2)

		from wiki.api.wiki_space import rebuild_wiki_tree

		rebuild_wiki_tree()

		# Reload and check lft values
		page_c.reload()
		page_b.reload()
		page_a.reload()

		# Page C should have lowest lft (comes first)
		self.assertLess(page_c.lft, page_b.lft)
		self.assertLess(page_b.lft, page_a.lft)


# Helper functions


def create_test_wiki_space():
	"""Create a test Wiki Space with a root group."""
	root_group = frappe.new_doc("Wiki Document")
	root_group.title = f"Test Root {frappe.generate_hash(length=6)}"
	root_group.is_group = 1
	root_group.insert()

	space = frappe.new_doc("Wiki Space")
	space.space_name = f"Test Space {frappe.generate_hash(length=6)}"
	space.route = f"test-space-{frappe.generate_hash(length=6)}"
	space.root_group = root_group.name
	space.insert()

	return space


def create_wiki_document(parent: str, title: str, is_group: bool = False, content: str = ""):
	"""Create a Wiki Document."""
	doc = frappe.new_doc("Wiki Document")
	doc.title = title
	doc.parent_wiki_document = parent
	doc.is_group = 1 if is_group else 0
	doc.content = content
	doc.insert()
	return doc


def create_test_user(email: str, roles: list | None = None):
	"""Create a test user with specified roles.

	This function should be called while logged in as Administrator.
	"""
	# Save current user and switch to Administrator for user creation
	current_user = frappe.session.user
	frappe.set_user("Administrator")

	try:
		if frappe.db.exists("User", email):
			user = frappe.get_doc("User", email)
			# Update roles if specified
			if roles:
				for role in roles:
					if not user.has_role(role):
						user.add_roles(role)
			return user

		user = frappe.new_doc("User")
		user.email = email
		user.first_name = "Test"
		user.last_name = "User"
		user.send_welcome_email = 0
		user.insert()

		# Add specified roles or default to Website Manager
		if roles:
			user.add_roles(*roles)
		else:
			user.add_roles("Website Manager")

		return user
	finally:
		# Restore original user
		frappe.set_user(current_user)


def create_wiki_manager_user(email: str):
	"""Create a test user with Wiki Manager role."""
	return create_test_user(email, roles=["Wiki Manager"])


class TestWikiDocumentPermissions(FrappeTestCase):
	"""Tests for Wiki Document permission enforcement."""

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_wiki_manager_can_edit_document_directly(self):
		"""Test that Wiki Manager can edit documents directly via API."""
		space = create_test_wiki_space()
		page = create_wiki_document(space.root_group, "Test Page", content="Original content")

		# Create a Wiki Manager user
		manager = create_wiki_manager_user("manager@test.com")
		frappe.set_user(manager.name)

		# Manager should be able to edit the document directly
		page.content = "Updated content"
		page.save()  # Should not raise

		page.reload()
		self.assertEqual(page.content, "Updated content")

	def test_regular_user_cannot_edit_document_directly(self):
		"""Test that regular user cannot edit documents directly."""
		space = create_test_wiki_space()
		page = create_wiki_document(space.root_group, "Test Page", content="Original content")

		# Create a regular user (no Wiki Manager role)
		user = create_test_user("regular@test.com")
		frappe.set_user(user.name)

		# Regular user should NOT be able to edit directly
		page.content = "Hacked content"
		with self.assertRaises(frappe.PermissionError):
			page.save()

	def test_regular_user_cannot_delete_document(self):
		"""Test that regular user cannot delete documents."""
		space = create_test_wiki_space()
		page = create_wiki_document(space.root_group, "Test Page")

		user = create_test_user("deleter@test.com")
		frappe.set_user(user.name)

		with self.assertRaises(frappe.PermissionError):
			page.delete()

	def test_regular_user_cannot_create_document_directly(self):
		"""Test that regular user cannot create documents directly."""
		space = create_test_wiki_space()

		user = create_test_user("creator@test.com")
		frappe.set_user(user.name)

		doc = frappe.new_doc("Wiki Document")
		doc.title = "Unauthorized Page"
		doc.parent_wiki_document = space.root_group
		doc.content = "Content"

		with self.assertRaises(frappe.PermissionError):
			doc.insert()

	def test_wiki_manager_can_create_document(self):
		"""Test that Wiki Manager can create documents."""
		space = create_test_wiki_space()

		manager = create_wiki_manager_user("manager2@test.com")
		frappe.set_user(manager.name)

		doc = frappe.new_doc("Wiki Document")
		doc.title = "Manager Page"
		doc.parent_wiki_document = space.root_group
		doc.content = "Content"
		doc.insert()  # Should not raise

		self.assertTrue(frappe.db.exists("Wiki Document", doc.name))

	def test_wiki_manager_can_delete_document(self):
		"""Test that Wiki Manager can delete documents."""
		space = create_test_wiki_space()
		page = create_wiki_document(space.root_group, "Page to Delete")

		manager = create_wiki_manager_user("manager3@test.com")
		frappe.set_user(manager.name)

		page_name = page.name
		page.delete()  # Should not raise

		self.assertFalse(frappe.db.exists("Wiki Document", page_name))


class TestWikiSpacePermissions(FrappeTestCase):
	"""Tests for Wiki Space permission enforcement."""

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_regular_user_cannot_create_space(self):
		"""Test that regular user cannot create wiki spaces."""
		user = create_test_user("spaceuser@test.com")
		frappe.set_user(user.name)

		root = frappe.new_doc("Wiki Document")
		root.title = "Unauthorized Root"
		root.is_group = 1

		# First, user can't create documents
		with self.assertRaises(frappe.PermissionError):
			root.insert()

	def test_wiki_manager_can_create_space(self):
		"""Test that Wiki Manager can create wiki spaces."""
		manager = create_wiki_manager_user("spacemanager@test.com")
		frappe.set_user(manager.name)

		root = frappe.new_doc("Wiki Document")
		root.title = "Manager Root"
		root.is_group = 1
		root.insert()

		space = frappe.new_doc("Wiki Space")
		space.space_name = "Manager Space"
		space.route = f"manager-space-{frappe.generate_hash(length=6)}"
		space.root_group = root.name
		space.insert()  # Should not raise

		self.assertTrue(frappe.db.exists("Wiki Space", space.name))

	def test_regular_user_cannot_modify_space_settings(self):
		"""Test that regular user cannot modify space settings."""
		space = create_test_wiki_space()

		user = create_test_user("spaceeditor@test.com")
		frappe.set_user(user.name)

		space.space_name = "Hacked Space Name"
		with self.assertRaises(frappe.PermissionError):
			space.save()
