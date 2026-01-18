# Copyright (c) 2023, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase


class TestWikiSpace(IntegrationTestCase):
	pass


class TestUpdateRoutes(IntegrationTestCase):
	"""Tests for the update_routes method of WikiSpace."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.test_docs = []
		cls.test_spaces = []

	def tearDown(self):
		# Clean up test documents in reverse order (children first)
		for doc_name in reversed(self.test_docs):
			if frappe.db.exists("Wiki Document", doc_name):
				frappe.delete_doc("Wiki Document", doc_name, force=True)
		self.test_docs = []

		# Clean up test spaces
		for space_name in self.test_spaces:
			if frappe.db.exists("Wiki Space", space_name):
				frappe.delete_doc("Wiki Space", space_name, force=True)
		self.test_spaces = []

	def _create_wiki_document(
		self, title, route, parent=None, is_group=False, is_published=True, sort_order=0
	):
		"""Helper to create a wiki document for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": title,
				"route": route,
				"parent_wiki_document": parent,
				"is_group": is_group,
				"is_published": is_published,
				"sort_order": sort_order,
				"content": f"Content for {title}",
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_docs.append(doc.name)
		return doc

	def _create_wiki_space(self, space_name, route, root_group=None, skip_root_group=False):
		"""Helper to create a wiki space for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"space_name": space_name,
				"route": route,
				"root_group": root_group,
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_spaces.append(doc.name)

		# If skip_root_group is True, clear the root_group after insert
		if skip_root_group and doc.root_group:
			# Delete the auto-created root group
			auto_root = doc.root_group
			frappe.db.set_value("Wiki Space", doc.name, "root_group", None)
			doc.root_group = None
			if frappe.db.exists("Wiki Document", auto_root):
				frappe.delete_doc("Wiki Document", auto_root, force=True)

		return doc

	def _create_space_with_tree(self, base_route="test-docs", space_name="Test Space"):
		"""Create a Wiki Space with a tree of documents."""
		# Create root group (note: Wiki Document strips leading slashes in validate)
		root = self._create_wiki_document(f"{space_name} Root", base_route, is_group=True)

		# Create child group
		group1 = self._create_wiki_document(
			"Getting Started",
			f"{base_route}/getting-started",
			parent=root.name,
			is_group=True,
		)

		# Create leaf documents
		page1 = self._create_wiki_document(
			"Introduction",
			f"{base_route}/getting-started/introduction",
			parent=group1.name,
		)
		page2 = self._create_wiki_document(
			"Installation",
			f"{base_route}/getting-started/installation",
			parent=group1.name,
		)

		# Create space
		space = self._create_wiki_space(space_name, base_route, root.name)

		return space, root, group1, page1, page2

	def test_update_routes_success(self):
		"""Test successful route update."""
		space, root, group1, page1, page2 = self._create_space_with_tree("old-docs", "Update Test Space")

		# Update routes
		result = space.update_routes("new-docs")

		# Verify space route updated
		space.reload()
		self.assertEqual(space.route, "new-docs")

		# Verify root group route updated
		root.reload()
		self.assertEqual(root.route, "new-docs")

		# Verify group route updated
		group1.reload()
		self.assertEqual(group1.route, "new-docs/getting-started")

		# Verify page routes updated
		page1.reload()
		self.assertEqual(page1.route, "new-docs/getting-started/introduction")

		page2.reload()
		self.assertEqual(page2.route, "new-docs/getting-started/installation")

		# Check count
		self.assertEqual(result["updated_count"], 4)  # root + group + 2 pages

	def test_update_routes_empty_route_fails(self):
		"""Test that empty route throws error."""
		space, _, _, _, _ = self._create_space_with_tree("empty-test", "Empty Route Test")

		self.assertRaises(Exception, space.update_routes, "")

	def test_update_routes_whitespace_only_fails(self):
		"""Test that whitespace-only route throws error."""
		space, _, _, _, _ = self._create_space_with_tree("whitespace-test", "Whitespace Test")

		self.assertRaises(Exception, space.update_routes, "   ")

	def test_update_routes_same_route_fails(self):
		"""Test that same route throws error."""
		space, _, _, _, _ = self._create_space_with_tree("same-route", "Same Route Test")

		self.assertRaises(Exception, space.update_routes, "same-route")

	def test_update_routes_strips_leading_slash(self):
		"""Test that leading slash is stripped from new route."""
		space, root, group1, page1, _ = self._create_space_with_tree("strip-test", "Strip Test")

		# Update with leading slash
		space.update_routes("/stripped-route")

		space.reload()
		self.assertEqual(space.route, "stripped-route")

		page1.reload()
		self.assertEqual(page1.route, "stripped-route/getting-started/introduction")

	def test_update_routes_strips_trailing_slash(self):
		"""Test that trailing slash is stripped from new route."""
		space, _, _, page1, _ = self._create_space_with_tree("trail-test", "Trail Test")

		# Update with trailing slash
		space.update_routes("trailed-route/")

		space.reload()
		self.assertEqual(space.route, "trailed-route")

		page1.reload()
		self.assertEqual(page1.route, "trailed-route/getting-started/introduction")

	def test_update_routes_conflict_with_other_space(self):
		"""Test that conflicting route with another space throws error."""
		space1, _, _, _, _ = self._create_space_with_tree("space-one", "Space One")
		self._create_space_with_tree("space-two", "Space Two")

		self.assertRaises(Exception, space1.update_routes, "space-two")

	def test_update_routes_no_root_group_fails(self):
		"""Test that space without root_group throws error."""
		# Create space without root_group (simulating pre-V3)
		space = self._create_wiki_space("Legacy Space", "legacy-route", skip_root_group=True)

		self.assertRaises(Exception, space.update_routes, "new-legacy")

	def test_update_routes_with_nested_structure(self):
		"""Test route update with deeply nested document structure."""
		base_route = "nested-test"

		# Create root (note: Wiki Document strips leading slashes)
		root = self._create_wiki_document("Nested Root", base_route, is_group=True)

		# Create level 1 group
		level1 = self._create_wiki_document(
			"Level 1", f"{base_route}/level-1", parent=root.name, is_group=True
		)

		# Create level 2 group
		level2 = self._create_wiki_document(
			"Level 2", f"{base_route}/level-1/level-2", parent=level1.name, is_group=True
		)

		# Create level 3 page
		level3 = self._create_wiki_document(
			"Deep Page", f"{base_route}/level-1/level-2/deep-page", parent=level2.name
		)

		# Create space
		space = self._create_wiki_space("Nested Space", base_route, root.name)

		# Update routes
		result = space.update_routes("new-nested")

		# Verify all routes updated correctly
		root.reload()
		self.assertEqual(root.route, "new-nested")

		level1.reload()
		self.assertEqual(level1.route, "new-nested/level-1")

		level2.reload()
		self.assertEqual(level2.route, "new-nested/level-1/level-2")

		level3.reload()
		self.assertEqual(level3.route, "new-nested/level-1/level-2/deep-page")

		self.assertEqual(result["updated_count"], 4)

	def test_update_routes_returns_correct_count(self):
		"""Test that the method returns the correct count of updated documents."""
		space, _, _, _, _ = self._create_space_with_tree("count-test", "Count Test")

		result = space.update_routes("new-count")

		# Should be 4: root_group + 1 group + 2 pages
		self.assertEqual(result["updated_count"], 4)

	def test_update_routes_with_similar_route_prefix(self):
		"""Test that routes with similar prefixes don't get incorrectly updated."""
		# Create first space (using unique routes to avoid conflict with default 'docs' route)
		space1, _, _, _, _ = self._create_space_with_tree("prefix-test", "Prefix Test Space")

		# Create second space with similar prefix
		root2 = self._create_wiki_document("Prefix Test API Root", "prefix-test-api", is_group=True)
		page2 = self._create_wiki_document("API Page", "prefix-test-api/endpoints", parent=root2.name)
		space2 = self._create_wiki_space("Prefix Test API Space", "prefix-test-api", root2.name)

		# Update first space's routes
		space1.update_routes("documentation")

		# Second space's routes should remain unchanged
		space2.reload()
		self.assertEqual(space2.route, "prefix-test-api")

		page2.reload()
		self.assertEqual(page2.route, "prefix-test-api/endpoints")
