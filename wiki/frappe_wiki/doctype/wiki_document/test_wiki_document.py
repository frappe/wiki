# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import functools
import glob
import json
import os
import re
import typing
import unittest
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import quote, urlparse
from xml.etree import ElementTree

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import get_test_client

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
	APP_ROUTE,
	WIKI_CONTENT_CACHE_KEY,
	WikiDocumentRenderer,
	clear_wiki_content_cache,
	clear_wiki_tree_cache,
	download_pdf,
	get_public_wiki_tree,
	get_rendered_content,
	get_space_tabs,
	process_navbar_items,
)
from wiki.wiki.markdown import render_markdown, render_markdown_with_toc

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


def create_test_wiki_document(test_case, title, **kwargs):
	"""Create a Wiki Document for testing and track it for cleanup."""
	fields = {
		"doctype": "Wiki Document",
		"title": title,
		"parent_wiki_document": kwargs.get("parent"),
		"is_group": kwargs.get("is_group", False),
		"is_published": kwargs.get("is_published", True),
		"sort_order": kwargs.get("sort_order", 0),
		"slug": kwargs.get("slug"),
		"is_external_link": kwargs.get("is_external_link", False),
		"external_url": kwargs.get("external_url"),
		"source_path": kwargs.get("source_path"),
		"content": kwargs.get("content") if kwargs.get("content") is not None else f"Content for {title}",
	}
	doc = frappe.get_doc(fields)
	doc.insert(ignore_permissions=True)
	test_case.test_docs.append(doc.name)
	return doc


def create_test_wiki_space(test_case, space_name, route, root_group, **kwargs):
	"""Create a Wiki Space for testing and track it for cleanup."""
	fields = {
		"doctype": "Wiki Space",
		"space_name": space_name,
		"route": route,
		"root_group": root_group,
		"show_in_switcher": kwargs.get("show_in_switcher", True),
		"is_published": kwargs.get("is_published", True),
		"switcher_order": kwargs.get("switcher_order", 0),
		"git_synced": kwargs.get("git_synced", False),
		"repo_full_name": kwargs.get("repo_full_name"),
		"branch": kwargs.get("branch"),
	}
	doc = frappe.get_doc(fields)
	for role, level in kwargs.get("roles", []):
		doc.append("roles", {"role": role, "permission_level": level})
	doc.insert(ignore_permissions=True)
	test_case.test_spaces.append(doc.name)
	# Track auto-created root_group for cleanup
	if not root_group and doc.root_group:
		test_case.test_docs.append(doc.root_group)
	return doc


class WikiDocumentTestBase(IntegrationTestCase):
	"""Base class with common setup/teardown for Wiki Document tests."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.test_docs = []
		cls.test_spaces = []

	def tearDown(self):
		for doc_name in reversed(self.test_docs):
			if frappe.db.exists("Wiki Document", doc_name):
				frappe.delete_doc("Wiki Document", doc_name, force=True)
		self.test_docs = []

		for space_name in self.test_spaces:
			if frappe.db.exists("Wiki Space", space_name):
				frappe.delete_doc("Wiki Space", space_name, force=True)
		self.test_spaces = []


class IntegrationTestWikiDocument(IntegrationTestCase):
	"""
	Integration tests for WikiDocument.
	Use this class for testing interactions between multiple components.
	"""

	pass


class TestGetWebContext(WikiDocumentTestBase):
	"""
	Unit tests for the get_web_context method of WikiDocument.
	Tests navigation (prev/next doc) edge cases and wiki spaces switcher.
	"""

	def test_first_document_has_no_prev_doc(self):
		"""Test that the first document in the tree has no previous document."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = create_test_wiki_document(self, "Test Root Group", is_group=True)
		doc1 = create_test_wiki_document(self, "First Document", parent=root_group.name)
		create_test_wiki_document(self, "Second Document", parent=root_group.name)
		create_test_wiki_document(self, "Third Document", parent=root_group.name)

		# Create wiki space
		create_test_wiki_space(self, "Test Space", "test-space", root_group.name)

		# Get context for the first document
		doc1.reload()
		context = doc1.get_web_context()

		# First document should have no prev_doc but should have next_doc
		self.assertIsNone(context["prev_doc"])
		self.assertIsNotNone(context["next_doc"])
		self.assertEqual(context["next_doc"]["title"], "Second Document")

	def test_last_document_has_no_next_doc(self):
		"""Test that the last document in the tree has no next document."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = create_test_wiki_document(self, "Test Root Group Last", is_group=True)
		create_test_wiki_document(self, "First Doc", parent=root_group.name)
		create_test_wiki_document(self, "Second Doc", parent=root_group.name)
		doc3 = create_test_wiki_document(self, "Third Doc", parent=root_group.name)

		# Create wiki space
		create_test_wiki_space(self, "Test Space Last", "test-space-last", root_group.name)

		# Get context for the last document
		doc3.reload()
		context = doc3.get_web_context()

		# Last document should have prev_doc but no next_doc
		self.assertIsNotNone(context["prev_doc"])
		self.assertEqual(context["prev_doc"]["title"], "Second Doc")
		self.assertIsNone(context["next_doc"])

	def test_middle_document_has_both_prev_and_next(self):
		"""Test that a middle document has both prev and next documents."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = create_test_wiki_document(self, "Test Root Group Middle", is_group=True)
		create_test_wiki_document(self, "First Page", parent=root_group.name)
		doc2 = create_test_wiki_document(self, "Middle Page", parent=root_group.name)
		create_test_wiki_document(self, "Last Page", parent=root_group.name)

		# Create wiki space
		create_test_wiki_space(self, "Test Space Middle", "test-space-middle", root_group.name)

		# Get context for the middle document
		doc2.reload()
		context = doc2.get_web_context()

		# Middle document should have both prev_doc and next_doc
		self.assertIsNotNone(context["prev_doc"])
		self.assertEqual(context["prev_doc"]["title"], "First Page")
		self.assertIsNotNone(context["next_doc"])
		self.assertEqual(context["next_doc"]["title"], "Last Page")

	def test_single_document_has_no_prev_or_next(self):
		"""Test that a single document in the tree has neither prev nor next."""
		# Create a tree with only one document
		root_group = create_test_wiki_document(self, "Test Root Group Single", is_group=True)
		only_doc = create_test_wiki_document(self, "Only Document", parent=root_group.name)

		# Create wiki space
		create_test_wiki_space(self, "Test Space Single", "test-space-single", root_group.name)

		# Get context for the only document
		only_doc.reload()
		context = only_doc.get_web_context()

		# Single document should have neither prev_doc nor next_doc
		self.assertIsNone(context["prev_doc"])
		self.assertIsNone(context["next_doc"])

	def test_wiki_spaces_for_switcher_includes_current_space_even_if_not_published(self):
		"""
		Test that wiki_spaces_for_switcher includes the current space
		even when show_in_switcher is disabled, because of or_filters.
		"""
		# Create three wiki spaces with their root groups
		root1 = create_test_wiki_document(self, "Root Group Space 1", is_group=True)
		doc1 = create_test_wiki_document(self, "Doc in Space 1", parent=root1.name)

		root2 = create_test_wiki_document(self, "Root Group Space 2", is_group=True)
		create_test_wiki_document(self, "Doc in Space 2", parent=root2.name)

		root3 = create_test_wiki_document(self, "Root Group Space 3", is_group=True)
		create_test_wiki_document(self, "Doc in Space 3", parent=root3.name)

		# Create spaces - Space 1 has show_in_switcher=False but current doc belongs to it
		create_test_wiki_space(self, "Space One", "space-one", root1.name, show_in_switcher=False)
		create_test_wiki_space(self, "Space Two", "space-two", root2.name, show_in_switcher=True)
		create_test_wiki_space(self, "Space Three", "space-three", root3.name, show_in_switcher=True)

		# Get context for doc in Space 1 (which has show_in_switcher=False)
		doc1.reload()
		context = doc1.get_web_context()

		# wiki_spaces_for_switcher should include all 3 test spaces:
		# - Space 1 because it's the current space (or_filter: name=space1.name)
		# - Space 2 and 3 because show_in_switcher=True
		# Note: There may be other pre-existing spaces in the database
		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		self.assertIn("Space One", space_names)
		self.assertIn("Space Two", space_names)
		self.assertIn("Space Three", space_names)
		# Ensure at least our 3 test spaces are included
		self.assertGreaterEqual(len(switcher_spaces), 3)

	def test_wiki_spaces_for_switcher_excludes_hidden_spaces(self):
		"""
		Test that wiki_spaces_for_switcher excludes spaces with show_in_switcher=False
		when viewing a document from a different space.
		"""
		# Create three wiki spaces with their root groups
		root1 = create_test_wiki_document(self, "Root Hidden Space", is_group=True)
		create_test_wiki_document(self, "Doc in Hidden Space", parent=root1.name)

		root2 = create_test_wiki_document(self, "Root Visible Space", is_group=True)
		doc2 = create_test_wiki_document(self, "Doc in Visible Space", parent=root2.name)

		root3 = create_test_wiki_document(self, "Root Another Visible", is_group=True)
		create_test_wiki_document(self, "Doc in Another Visible", parent=root3.name)

		# Create spaces - Space 1 (Hidden) has show_in_switcher=False
		create_test_wiki_space(self, "Hidden Space", "hidden-space", root1.name, show_in_switcher=False)
		create_test_wiki_space(self, "Visible Space", "visible-space", root2.name, show_in_switcher=True)
		create_test_wiki_space(self, "Another Visible", "another-visible", root3.name, show_in_switcher=True)

		# Get context for doc in Visible Space
		doc2.reload()
		context = doc2.get_web_context()

		# wiki_spaces_for_switcher should include only visible spaces + current space
		# Since current space (Visible Space) has show_in_switcher=True,
		# Hidden Space should be excluded
		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		self.assertNotIn("Hidden Space", space_names)
		self.assertIn("Visible Space", space_names)
		self.assertIn("Another Visible", space_names)
		# At least our 2 visible test spaces should be included
		self.assertGreaterEqual(len(switcher_spaces), 2)

	def test_orphan_document_without_wiki_space(self):
		"""
		Test that get_web_context handles a document that is not associated
		with any Wiki Space (no parent, standalone published document).
		"""
		# Create a standalone document with no parent and no wiki space
		orphan_doc = create_test_wiki_document(
			self,
			"Orphan Published Document",
			parent=None,
			is_group=False,
			is_published=True,
		)

		# Get context for the orphan document
		orphan_doc.reload()
		context = orphan_doc.get_web_context()

		# The document should still return a valid context
		# Even without a wiki space, these should be handled gracefully
		self.assertIsNone(context.get("prev_doc"))
		self.assertIsNone(context.get("next_doc"))
		self.assertIsNone(context.get("wiki_space"))
		self.assertEqual(context.get("wiki_spaces_for_switcher"), [])
		self.assertEqual(context.get("navbar_items"), [])
		self.assertEqual(context.get("nested_tree"), [])
		self.assertIsNone(context.get("favicon"))

		# hide_chrome should be True to hide sidebar, search, navbar
		self.assertTrue(context.get("hide_chrome"))

		# Content should still be rendered
		self.assertIsNotNone(context.get("rendered_content"))
		self.assertEqual(context.get("title"), "Orphan Published Document")

	def test_get_web_context_renders_video_markdown_as_html_video_block(self):
		"""Video markdown should render as HTML5 video in public page context."""
		root_group = create_test_wiki_document(self, "Root Video Group", is_group=True)
		video_doc = create_test_wiki_document(
			self,
			"Video Document",
			parent=root_group.name,
			content="![Demo Video](/files/demo-video.mp4)",
		)
		create_test_wiki_space(self, "Video Space", "video-space", root_group.name)

		video_doc.reload()
		context = video_doc.get_web_context()

		self.assertIn('<div data-type="video-block"', context["rendered_content"])
		self.assertIn(
			'<video src="/files/demo-video.mp4" controls preload="metadata">',
			context["rendered_content"],
		)
		self.assertIn('<source src="/files/demo-video.mp4" />', context["rendered_content"])
		self.assertNotIn('<img src="/files/demo-video.mp4"', context["rendered_content"])

	def test_wiki_spaces_for_switcher_ordered_by_switcher_order_then_name(self):
		"""
		Test that wiki_spaces_for_switcher is ordered by switcher_order first,
		then alphabetically by space_name.
		"""
		# Create wiki spaces with their root groups
		root1 = create_test_wiki_document(self, "Root Zebra Space", is_group=True)
		doc1 = create_test_wiki_document(self, "Doc in Zebra Space", parent=root1.name)

		root2 = create_test_wiki_document(self, "Root Alpha Space", is_group=True)
		create_test_wiki_document(self, "Doc in Alpha Space", parent=root2.name)

		root3 = create_test_wiki_document(self, "Root Beta Space", is_group=True)
		create_test_wiki_document(self, "Doc in Beta Space", parent=root3.name)

		root4 = create_test_wiki_document(self, "Root Gamma Space", is_group=True)
		create_test_wiki_document(self, "Doc in Gamma Space", parent=root4.name)

		# Create spaces with different switcher_order values
		# Zebra has order 1, so should come first despite name
		# Alpha and Beta both have order 2, so should be sorted alphabetically
		# Gamma has order 3, so should come last
		create_test_wiki_space(self, "Zebra Space", "zebra-space", root1.name, switcher_order=1)
		create_test_wiki_space(self, "Alpha Space", "alpha-space", root2.name, switcher_order=2)
		create_test_wiki_space(self, "Beta Space", "beta-space", root3.name, switcher_order=2)
		create_test_wiki_space(self, "Gamma Space", "gamma-space", root4.name, switcher_order=3)

		# Get context for doc in Zebra Space
		doc1.reload()
		context = doc1.get_web_context()

		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		# Filter to only our test spaces to avoid interference from other spaces
		test_space_names = ["Zebra Space", "Alpha Space", "Beta Space", "Gamma Space"]
		filtered_spaces = [name for name in space_names if name in test_space_names]

		# Expected order: Zebra (order 1), Alpha (order 2), Beta (order 2), Gamma (order 3)
		expected_order = ["Zebra Space", "Alpha Space", "Beta Space", "Gamma Space"]
		self.assertEqual(filtered_spaces, expected_order)


class TestEditLink(WikiDocumentTestBase):
	"""get_edit_link: wiki editor for normal spaces, GitHub editor for synced ones."""

	def test_normal_space_links_to_wiki_editor(self):
		root_group = create_test_wiki_document(self, "Edit Link Root", is_group=True)
		doc = create_test_wiki_document(self, "Editable Page", parent=root_group.name)
		space = create_test_wiki_space(self, "Edit Link Space", "edit-link-space", root_group.name)

		doc.reload()
		self.assertEqual(doc.get_edit_link(), f"/{APP_ROUTE}/spaces/{space.name}/page/{doc.name}")

	def test_synced_space_links_to_github_editor(self):
		root_group = create_test_wiki_document(self, "Synced Edit Root", is_group=True)
		doc = create_test_wiki_document(
			self, "Synced Page", parent=root_group.name, source_path="docs/getting-started.md"
		)
		create_test_wiki_space(
			self,
			"Synced Edit Space",
			"synced-edit-space",
			root_group.name,
			git_synced=True,
			repo_full_name="acme/docs",
			branch="main",
		)

		doc.reload()
		self.assertEqual(
			doc.get_edit_link(),
			"https://github.com/acme/docs/edit/main/docs/getting-started.md",
		)
		context = doc.get_web_context()
		self.assertTrue(context["can_edit"])
		self.assertEqual(
			context["edit_link"], "https://github.com/acme/docs/edit/main/docs/getting-started.md"
		)

	def test_synced_folder_group_has_no_edit_link(self):
		root_group = create_test_wiki_document(self, "Synced Folder Root", is_group=True)
		group = create_test_wiki_document(
			self, "Folder Group", parent=root_group.name, is_group=True, source_path="docs/guides"
		)
		create_test_wiki_space(
			self,
			"Synced Folder Space",
			"synced-folder-space",
			root_group.name,
			git_synced=True,
			repo_full_name="acme/docs",
			branch="main",
		)

		group.reload()
		self.assertEqual(group.get_edit_link(), "")
		context = group.get_web_context()
		self.assertFalse(context["can_edit"])


class TestGetWebContextMetaTags(WikiDocumentTestBase):
	"""
	Unit tests for the metatags/canonical_url emission in get_web_context().
	Covers the meta_title/meta_description/meta_image fields and their
	fallbacks when unset.
	"""

	def test_metatags_use_explicit_meta_fields_when_set(self):
		"""When meta_title/description/image are set, metatags should reflect them."""
		root_group = create_test_wiki_document(self, "Root Meta Group", is_group=True)
		doc = create_test_wiki_document(self, "Meta Doc", parent=root_group.name, slug="meta-doc")
		create_test_wiki_space(self, "Meta Space", "meta-space", root_group.name)

		doc.meta_title = "Custom Meta Title"
		doc.meta_description = "Custom meta description for SEO."
		doc.meta_image = "/files/meta-preview.png"
		doc.save()
		doc.reload()

		context = doc.get_web_context()
		metatags = context["metatags"]

		self.assertEqual(metatags["title"], "Custom Meta Title")
		self.assertEqual(metatags["description"], "Custom meta description for SEO.")
		self.assertEqual(metatags["og:title"], "Custom Meta Title")
		self.assertEqual(metatags["og:image"], frappe.utils.get_url("/files/meta-preview.png"))
		self.assertEqual(metatags["twitter:card"], "summary_large_image")
		self.assertEqual(metatags["og:site_name"], "Meta Space")

		self.assertEqual(context["canonical_url"], frappe.utils.get_url("/" + doc.route))

	def test_metatags_fall_back_to_title_when_meta_fields_unset(self):
		"""With no meta_title/description, metatags should fall back sensibly.

		og:image is the one field with a generated fallback, so it is asserted
		with the cards turned off; TestOGImageMetaTags covers the on case.
		"""
		root_group = create_test_wiki_document(self, "Root Meta Fallback Group", is_group=True)
		doc = create_test_wiki_document(
			self, "Fallback Meta Doc", parent=root_group.name, slug="fallback-meta-doc"
		)
		create_test_wiki_space(self, "Fallback Meta Space", "fallback-meta-space", root_group.name)

		doc.reload()
		with self.change_settings("Wiki Settings", {"auto_generate_meta_images": 0}):
			context = doc.get_web_context()
		metatags = context["metatags"]

		self.assertEqual(metatags["title"], "Fallback Meta Doc")
		self.assertNotIn("description", metatags)
		self.assertNotIn("image", metatags)
		self.assertNotIn("og:image", metatags)
		self.assertEqual(metatags["twitter:card"], "summary")
		self.assertEqual(metatags["og:site_name"], "Fallback Meta Space")

		self.assertEqual(context["canonical_url"], frappe.utils.get_url("/" + doc.route))


class TestRenderedPageMetaTags(WikiDocumentTestBase):
	"""
	Integration tests that render the public page HTML and assert the
	og/twitter/canonical tags emitted by get_web_context() actually show up
	in the served head markup.
	"""

	TEST_CLIENT = get_test_client()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def test_rendered_head_contains_meta_tags_for_published_doc(self):
		# Create the space first (auto-creates root_group) so the doc's route
		# picks up the space prefix, matching TestSetRoute's pattern.
		route = self._unique("meta-render")
		space = create_test_wiki_space(self, "Meta Render Space", route, None, roles=[("Guest", "Read")])
		doc = create_test_wiki_document(
			self,
			"Meta Render Doc",
			parent=space.root_group,
			slug=self._unique("meta-render-doc"),
		)

		doc.meta_title = "Rendered Meta Title"
		doc.meta_description = "Rendered meta description."
		doc.meta_image = "/files/rendered-preview.png"
		doc.save()
		doc.reload()
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{doc.route}",
			headers={"Accept": "text/html"},
		)

		self.assertEqual(response.status_code, 200)
		html = response.get_data(as_text=True)

		self.assertRegex(html, r'property="og:title"\s*content="Rendered Meta Title"')
		self.assertRegex(html, rf'<link rel="canonical" href="[^"]*/{doc.route}">')

	def test_rendered_head_uses_generated_og_image_when_no_meta_image(self):
		route = self._unique("meta-render-fallback")
		space = create_test_wiki_space(
			self, "Meta Render Fallback Space", route, None, roles=[("Guest", "Read")]
		)
		doc = create_test_wiki_document(
			self,
			"Meta Render Fallback Doc",
			parent=space.root_group,
			slug=self._unique("meta-render-fallback-doc"),
		)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{doc.route}",
			headers={"Accept": "text/html"},
		)

		self.assertEqual(response.status_code, 200)
		html = response.get_data(as_text=True)

		self.assertRegex(html, r'name="twitter:card"\s*content="summary_large_image"')
		self.assertIn("wiki.api.og_image.og_image", html)
		self.assertRegex(html, rf'<link rel="canonical" href="[^"]*/{doc.route}">')

	def test_rendered_head_omits_image_tags_when_cards_are_disabled(self):
		"""With the Wiki Settings toggle off the emitted head is what it was
		before generated cards existed."""
		route = self._unique("meta-render-nocard")
		space = create_test_wiki_space(
			self, "Meta Render No Card Space", route, None, roles=[("Guest", "Read")]
		)
		doc = create_test_wiki_document(
			self,
			"Meta Render No Card Doc",
			parent=space.root_group,
			slug=self._unique("meta-render-nocard-doc"),
		)

		with self.change_settings("Wiki Settings", {"auto_generate_meta_images": 0}, commit=True):
			response = _make_request(
				self.TEST_CLIENT,
				"get",
				f"/{doc.route}",
				headers={"Accept": "text/html"},
			)

		self.assertEqual(response.status_code, 200)
		html = response.get_data(as_text=True)

		self.assertRegex(html, r'name="twitter:card"\s*content="summary"')
		self.assertNotIn('property="og:image"', html)


class TestGetWebContextBreadcrumbs(WikiDocumentTestBase):
	"""
	Unit tests for the BreadcrumbList JSON-LD emission in get_web_context().
	Ancestor groups are non-clickable in the reader sidebar (toggle buttons,
	not links), so per Google's structured-data rules they're dropped from
	the trail rather than emitted without a URL -- only the space and the
	current page appear.
	"""

	def test_breadcrumbs_include_space_and_current_page_only(self):
		"""Nested space -> group -> group -> page collapses to [space, page]."""
		space = create_test_wiki_space(self, "Breadcrumb Space", "breadcrumb-space", None)
		group = create_test_wiki_document(self, "Breadcrumb Group", parent=space.root_group, is_group=True)
		subgroup = create_test_wiki_document(self, "Breadcrumb Subgroup", parent=group.name, is_group=True)
		doc = create_test_wiki_document(self, "Breadcrumb Doc", parent=subgroup.name, slug="breadcrumb-doc")
		doc.reload()

		context = doc.get_web_context()
		breadcrumbs = json.loads(context["breadcrumbs"])

		self.assertEqual(breadcrumbs["@context"], "https://schema.org")
		self.assertEqual(breadcrumbs["@type"], "BreadcrumbList")

		items = breadcrumbs["itemListElement"]
		self.assertEqual(len(items), 2)

		self.assertEqual(items[0]["@type"], "ListItem")
		self.assertEqual(items[0]["position"], 1)
		self.assertEqual(items[0]["name"], "Breadcrumb Space")
		self.assertEqual(items[0]["item"], frappe.utils.get_url("/breadcrumb-space"))

		self.assertEqual(items[1]["@type"], "ListItem")
		self.assertEqual(items[1]["position"], 2)
		self.assertEqual(items[1]["name"], "Breadcrumb Doc")
		self.assertEqual(items[1]["item"], frappe.utils.get_url("/" + doc.route))

		# Intermediate group names must not leak into the trail.
		names = [item["name"] for item in items]
		self.assertNotIn("Breadcrumb Group", names)
		self.assertNotIn("Breadcrumb Subgroup", names)

	def test_breadcrumbs_absent_for_orphan_document(self):
		"""Documents with no wiki_space (chromeless/orphan) get no breadcrumbs."""
		orphan = create_test_wiki_document(self, "Orphan Breadcrumb Doc")
		orphan.reload()

		context = orphan.get_web_context()

		self.assertIsNone(context["breadcrumbs"])

	def test_breadcrumbs_escape_script_breaking_titles(self):
		"""No raw "<" may reach the serialized JSON, since the template embeds
		it inside a <script> element. Frappe's save-time sanitization already
		strips tags from Data fields, so force a hostile title in memory to
		exercise the serialization-layer escape directly."""
		space = create_test_wiki_space(self, "Escape Space", "breadcrumb-escape-space", None)
		doc = create_test_wiki_document(self, "Sneaky Doc", parent=space.root_group, slug="sneaky")
		doc.reload()
		doc.title = "Sneaky </script><script>alert(1)</script>"

		serialized = doc.get_web_context()["breadcrumbs"]

		self.assertNotIn("<", serialized)
		parsed = json.loads(serialized)
		self.assertEqual(parsed["itemListElement"][-1]["name"], "Sneaky </script><script>alert(1)</script>")


class TestRenderedPageBreadcrumbs(WikiDocumentTestBase):
	"""
	Integration tests that render the public page HTML and assert the
	BreadcrumbList JSON-LD script emitted by get_web_context() actually
	shows up in the served head markup as valid, parseable JSON.
	"""

	TEST_CLIENT = get_test_client()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def _extract_json_ld(self, html):
		match = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
		self.assertIsNotNone(match, "BreadcrumbList JSON-LD script not found in rendered head")
		return json.loads(match.group(1))

	def test_rendered_head_contains_breadcrumb_list(self):
		route = self._unique("breadcrumb-render")
		space = create_test_wiki_space(
			self, "Breadcrumb Render Space", route, None, roles=[("Guest", "Read")]
		)
		group = create_test_wiki_document(
			self, "Breadcrumb Render Group", parent=space.root_group, is_group=True
		)
		doc = create_test_wiki_document(
			self,
			"Breadcrumb Render Doc",
			parent=group.name,
			slug=self._unique("breadcrumb-render-doc"),
		)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{doc.route}",
			headers={"Accept": "text/html"},
		)

		self.assertEqual(response.status_code, 200)
		html = response.get_data(as_text=True)

		breadcrumbs = self._extract_json_ld(html)
		self.assertEqual(breadcrumbs["@type"], "BreadcrumbList")

		items = breadcrumbs["itemListElement"]
		self.assertEqual(items[-1]["name"], "Breadcrumb Render Doc")
		self.assertEqual(items[0]["name"], "Breadcrumb Render Space")
		# The request thread patches the site to wiki.localhost, so compare by
		# suffix rather than exact host (matches the canonical_url regex checks
		# in TestRenderedPageMetaTags above).
		self.assertTrue(items[0]["item"].endswith("/" + route))


class TestMarkdownCallouts(unittest.TestCase):
	"""
	Unit tests for the markdown callout/aside rendering.
	Tests the Astro Starlight-style :::type[title] syntax.
	"""

	def test_basic_note_callout(self):
		"""Test basic :::note callout with default title"""
		md = """:::note
This is a note
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-note"', html)
		self.assertIn('<span class="callout-title">Note</span>', html)
		self.assertIn("This is a note", html)

	def test_tip_callout(self):
		"""Test :::tip callout"""
		md = """:::tip
This is a tip
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-tip"', html)
		self.assertIn('<span class="callout-title">Tip</span>', html)

	def test_caution_callout(self):
		"""Test :::caution callout"""
		md = """:::caution
This is a caution
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-caution"', html)
		self.assertIn('<span class="callout-title">Caution</span>', html)

	def test_danger_callout(self):
		"""Test :::danger callout"""
		md = """:::danger
This is dangerous
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-danger"', html)
		self.assertIn('<span class="callout-title">Danger</span>', html)

	def test_warning_alias_for_caution(self):
		"""Test :::warning is aliased to caution"""
		md = """:::warning
This is a warning
:::"""
		html = render_markdown(md)
		# warning should be rendered as caution
		self.assertIn('class="callout callout-caution"', html)

	def test_custom_title(self):
		"""Test callout with custom title in brackets"""
		md = """:::tip[Did you know?]
This is a tip with a custom title
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-tip"', html)
		self.assertIn('<span class="callout-title">Did you know?</span>', html)

	def test_custom_title_all_types(self):
		"""Test custom titles work for all callout types"""
		types_and_titles = [
			("note", "Important Information"),
			("tip", "Pro Tip"),
			("caution", "Be Careful"),
			("danger", "Critical Warning"),
		]
		for callout_type, title in types_and_titles:
			md = f""":::{callout_type}[{title}]
Content here
:::"""
			html = render_markdown(md)
			self.assertIn(f'class="callout callout-{callout_type}"', html)
			self.assertIn(f'<span class="callout-title">{title}</span>', html)

	def test_custom_title_with_special_characters(self):
		"""Test custom title with special characters"""
		md = """:::note[What's this? A "special" title!]
Content here
:::"""
		html = render_markdown(md)
		self.assertIn('<span class="callout-title">What\'s this? A "special" title!</span>', html)

	def test_custom_title_empty_brackets(self):
		"""Test callout with empty brackets uses default title"""
		md = """:::note[]
Content here
:::"""
		html = render_markdown(md)
		self.assertIn('<span class="callout-title">Note</span>', html)

	def test_custom_title_warning_alias(self):
		"""Test custom title with warning type (aliased to caution)"""
		md = """:::warning[Watch Out!]
Be careful here
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-caution"', html)
		self.assertIn('<span class="callout-title">Watch Out!</span>', html)

	def test_callout_with_markdown_content(self):
		"""Test callout with markdown formatting inside"""
		md = """:::note
This has **bold** and *italic* text
:::"""
		html = render_markdown(md)
		self.assertIn("<strong>bold</strong>", html)
		self.assertIn("<em>italic</em>", html)

	def test_callout_with_link(self):
		"""Test callout with markdown link"""
		md = """:::note
Check out [this link](https://example.com)
:::"""
		html = render_markdown(md)
		self.assertIn('<a href="https://example.com">this link</a>', html)

	def test_callout_with_code_block(self):
		"""Test callout with fenced code block inside"""
		md = """:::note
Here's some code:

```python
print("Hello")
```
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-note"', html)
		# Quotes may be HTML-encoded as &quot;
		self.assertTrue('print("Hello")' in html or "print(&quot;Hello&quot;)" in html)
		self.assertIn("<code", html)
		self.assertIn("language-python", html)

	def test_callout_with_list(self):
		"""Test callout with bullet list"""
		md = """:::tip
Here are some items:

- Item 1
- Item 2
- Item 3
:::"""
		html = render_markdown(md)
		self.assertIn("<li>Item 1</li>", html)
		self.assertIn("<li>Item 2</li>", html)

	def test_multiple_callouts(self):
		"""Test multiple callouts in same document"""
		md = """:::note
First callout
:::

Some text in between

:::danger
Second callout
:::"""
		html = render_markdown(md)
		self.assertIn("callout-note", html)
		self.assertIn("callout-danger", html)
		self.assertIn("First callout", html)
		self.assertIn("Second callout", html)

	def test_callout_has_icon(self):
		"""Test that callouts include SVG icons"""
		md = """:::note
Content
:::"""
		html = render_markdown(md)
		self.assertIn("<svg", html)
		self.assertIn("</svg>", html)

	def test_empty_content(self):
		"""Test render_markdown with empty string"""
		self.assertEqual(render_markdown(""), "")
		self.assertEqual(render_markdown(None), "")

	def test_regular_markdown_still_works(self):
		"""Test that regular markdown without callouts still renders"""
		md = """# Heading

This is a paragraph with **bold** text.

- List item 1
- List item 2
"""
		html = render_markdown(md)
		self.assertIn('<h1 id="heading">Heading</h1>', html)
		self.assertIn("<strong>bold</strong>", html)
		self.assertIn("<li>List item 1</li>", html)

	def test_callout_mixed_with_regular_content(self):
		"""Test callout mixed with regular markdown"""
		md = """# Introduction

This is some intro text.

:::note
Important note here
:::

And this is the conclusion.
"""
		html = render_markdown(md)
		self.assertIn('<h1 id="introduction">Introduction</h1>', html)
		self.assertIn("callout-note", html)
		self.assertIn("Important note here", html)
		self.assertIn("conclusion", html)

	def test_markdown_toc_for_security_faq(self):
		"""Test TOC extraction for security FAQ markdown content."""
		md = """## Infrastructure & Hosting

### What uptime guarantee do you provide?

We provide hosting via multiple cloud providers with the following uptime guarantees:

| Provider      | Uptime Guarantee                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS           | [99.0 - 99.5%](https://aws.amazon.com/compute/sla/?did=sla_card&trk=sla_card)                                                                                                                                              |
| Digital Ocean | [99.99%](https://www.digitalocean.com/sla/cpu-droplets)                                                                                                                                                                    |
| OCI           | [99.9%](https://www.oracle.com/content/published/api/v1.1/assets/CONT95B931480DF242229DF530A64F0D0245/native/Oracle+PaaS+and+IaaS+Public+Cloud+Services+Pillar+Document.pdf?channelToken=117bec9b3b4e4e90a1c4c9069d210baf) |

We monitor uptime of each server and notify users via email if their server is consistently down. Engineers are notified via call for extended downtime.

### Do you have maintenance windows?

No specific maintenance window policy is in place due to varying activity types. We inform users beforehand via email about potential downtime during maintenance activities.

### Is EBS volume/storage encrypted?

No, EBS volumes/storage attached to Frappe Cloud instances are not encrypted.

## Network Security & Access Control

### How is network security implemented?

We use a combination of security groups and firewalls to secure networks. VPCs isolate resources and restrict access. Only necessary ports are open to the public internet; all other ports are blocked by default.

### How do you manage server access?

We use SSH with certificates and/or public keys for server access. Passwords are not used. Users can only access benches with SSH certificates.

### Is there a WAF protecting applications?

Our infrastructure relies on AWS security groups for basic firewall functionality. There is no dedicated WAF solution.

### Is there an IPS/IDS solution in place?

No, there is no Intrusion Prevention/Detection System currently implemented.

### What DDoS mitigation measures are in place?

We do not have specific DDoS mitigation measures in place currently.

## Data Protection & Encryption

### What database is used? (RDS, Aurora, etc.)

We use MariaDB as the database for Frappe Cloud instances. We manage the database directly on the server on an AWS EC2 instance, not using services like RDS or Aurora.

### Is there High Availability for databases?

There is no High Availability setup for databases by default. We allow [dedicated server](https://docs.frappe.io/cloud/servers/servers-introduction) users to set up their own replication on request basis. You can raise a ticket for the same on our [support portal](https://support.frappe.io).

### Is there automated failover for databases?

No, there is no automated failover for databases on Frappe Cloud.

### What is the RPO and RTO for databases?

The RPO (Recovery Point Objective) for databases is up to 24 hours, as backups are taken daily. The RTO (Recovery Time Objective) can vary based on the size of the database and the time taken to restore from backups, typically ranging from a few hours to several hours. It is noted to be under 15 mintues as per our drills.

### Is point-in-time recovery available?

No, point-in-time recovery is not available for databases on Frappe Cloud.

### What encryption is used for communication?

We use HTTPS for all internet communication. SSH connections are also encrypted.

### Are databases encrypted at rest?

No, MariaDB databases are not encrypted at rest.

### Are backups encrypted?

Backups are unencrypted by default. Users can enable encryption by following our [backup encryption documentation](https://docs.frappe.io/framework/user/en/guides/basics/how-to-enable-backup-encryption). This uses fernet encryption (AES + HMAC).

## Security Monitoring & Management

### What antimalware software is used?

We use ClamAV for antimalware protection on all servers. Virus definitions are updated manually as needed. Regular scans are not implemented to maintain performance.

### Is there an EDR solution monitoring servers?

No, there is no Endpoint Detection and Response solution currently implemented.

### Are containers scanned for vulnerabilities?

No, containers are not scanned for malware or vulnerabilities.

### Do you use multi-factor authentication?

Yes, we have 2FA enabled for all logins to third-party services.

## Patch Management & Updates

### How are OS security patches managed?

We use unattended upgrades to deploy patches automatically on a daily basis across all servers.

### How are Frappe Framework updates handled?

On shared benches, Frappe Framework updates are managed by the Frappe Cloud team, typically occurring weekly or with major updates. Private bench users can manage updates themselves. See [bench documentation](https://docs.frappe.io/cloud/benches) for details.

### How are MariaDB updates managed?

MariaDB security updates are handled via Ubuntu's unattended-upgrades system.

### How are Python and dependency updates managed?

Python and other dependencies are managed via benches. Users can manage them through `Bench `> `Dependencies`.

### Do you have a formal patch management policy?

Yes, we have a comprehensive patch management process that covers implementation and tracking of ongoing patch compliance for all systems within our IT scope.

**Process Triggers:**

- Ongoing patch updating process
- Vulnerability assessment results
- Vulnerability alerts from vendors/OEM/security forums

**Server Patch Deployment Process:**

- Critical security patches applied automatically via Ubuntu's unattended upgrades
- Previous backups or application utilities used for system rollback when needed

### Where can I check for recent security patches?

You can check security advisories on relevant GitHub repositories:

- Frappe Framework: [Security Board](https://github.com/frappe/frappe/security/advisories)
- Frappe Cloud: [Security Board](https://github.com/frappe/press/security/advisories)

## Version Information

### How can I check current Frappe version?

You can check the current Frappe version by going to `Bench `> `Apps`.

### How can I check current MariaDB version?

You can check the current MariaDB version by going to `Server` > `Actions `> `View Database Configuration`.

### How can I check current Python version?

You can check the current Python version by going to `Bench `> `Dependencies`.

## Backup & Disaster Recovery

### What backup policy do you follow?

We take logical site backups as per our [backup policy](https://frappecloud.com/docs/sites/backups). Server-wide snapshots (including data volume) are taken daily, and are retained for 2 days.

### What disaster recovery measures are in place?

We maintain server-wide multi-AZ snapshots taken daily. In case of disaster, we plan to restore from these snapshots.

> **Note:** For KSA, backups are not multi-AZ yet. We intend to improve this in the future. [Reference](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumebackups.htm#Copying)

## Compliance & Certifications

### What certifications do you have?

Yes, we are certified under ISO 9001:2015, ISO 27001:2022, and SOC-2 Type-2 standards. Check [our compliance page](https://frappe.io/quality-and-information-security) for more information.

### Do you conduct penetration testing?

Yes, the Frappe Cloud platform undergone formal third-party penetration testing within the last 12-18 months.

### Do you conduct vulnerability scans?

Yes, we conduct regular internal and external vulnerability scans on our cloud infrastructure as part of our ongoing vulnerability management program.
"""

		_, toc_headings = render_markdown_with_toc(md)

		expected_texts = [
			"Infrastructure & Hosting",
			"What uptime guarantee do you provide?",
			"Do you have maintenance windows?",
			"Is EBS volume/storage encrypted?",
			"Network Security & Access Control",
			"How is network security implemented?",
			"How do you manage server access?",
			"Is there a WAF protecting applications?",
			"Is there an IPS/IDS solution in place?",
			"What DDoS mitigation measures are in place?",
			"Data Protection & Encryption",
			"What database is used? (RDS, Aurora, etc.)",
			"Is there High Availability for databases?",
			"Is there automated failover for databases?",
			"What is the RPO and RTO for databases?",
			"Is point-in-time recovery available?",
			"What encryption is used for communication?",
			"Are databases encrypted at rest?",
			"Are backups encrypted?",
			"Security Monitoring & Management",
			"What antimalware software is used?",
			"Is there an EDR solution monitoring servers?",
			"Are containers scanned for vulnerabilities?",
			"Do you use multi-factor authentication?",
			"Patch Management & Updates",
			"How are OS security patches managed?",
			"How are Frappe Framework updates handled?",
			"How are MariaDB updates managed?",
			"How are Python and dependency updates managed?",
			"Do you have a formal patch management policy?",
			"Where can I check for recent security patches?",
			"Version Information",
			"How can I check current Frappe version?",
			"How can I check current MariaDB version?",
			"How can I check current Python version?",
			"Backup & Disaster Recovery",
			"What backup policy do you follow?",
			"What disaster recovery measures are in place?",
			"Compliance & Certifications",
			"What certifications do you have?",
			"Do you conduct penetration testing?",
			"Do you conduct vulnerability scans?",
		]

		self.assertEqual([heading["text"] for heading in toc_headings], expected_texts)

		h2_headings = {
			"Infrastructure & Hosting",
			"Network Security & Access Control",
			"Data Protection & Encryption",
			"Security Monitoring & Management",
			"Patch Management & Updates",
			"Version Information",
			"Backup & Disaster Recovery",
			"Compliance & Certifications",
		}
		for heading in toc_headings:
			expected_level = 2 if heading["text"] in h2_headings else 3
			self.assertEqual(heading["level"], expected_level)

		ids = [heading["id"] for heading in toc_headings]
		self.assertTrue(all(ids))
		self.assertEqual(len(ids), len(set(ids)))


class TestProcessNavbarItems(unittest.TestCase):
	"""
	Unit tests for the process_navbar_items function.
	Tests icon detection for known services and navbar item processing.
	"""

	def _make_navbar_item(self, label, url, open_in_new_tab=False, right=False):
		"""Helper to create a mock navbar item (mimics Top Bar Item)."""
		return SimpleNamespace(
			label=label,
			url=url,
			open_in_new_tab=open_in_new_tab,
			right=right,
		)

	def test_github_url_detected(self):
		"""Test that GitHub URLs are detected and assigned the github icon."""
		items = [self._make_navbar_item("GitHub", "https://github.com/frappe/wiki")]
		result = process_navbar_items(items)

		self.assertEqual(len(result), 1)
		self.assertEqual(result[0]["icon"], "github")
		self.assertEqual(result[0]["label"], "GitHub")
		self.assertEqual(result[0]["url"], "https://github.com/frappe/wiki")

	def test_github_with_www_prefix(self):
		"""Test that www.github.com URLs are also detected."""
		items = [self._make_navbar_item("GitHub", "https://www.github.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "github")

	def test_youtube_url_detected(self):
		"""Test that YouTube URLs are detected."""
		items = [self._make_navbar_item("YouTube", "https://youtube.com/channel/xyz")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "youtube")

	def test_twitter_url_detected(self):
		"""Test that Twitter URLs are detected."""
		items = [self._make_navbar_item("Twitter", "https://twitter.com/fraaboride")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "twitter")

	def test_x_com_maps_to_twitter(self):
		"""Test that x.com URLs are mapped to twitter icon."""
		items = [self._make_navbar_item("X", "https://x.com/frappeframework")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "twitter")

	def test_discord_url_detected(self):
		"""Test that Discord URLs are detected."""
		items = [self._make_navbar_item("Discord", "https://discord.com/invite/abc")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "discord")

	def test_discord_gg_url_detected(self):
		"""Test that discord.gg invite URLs are detected."""
		items = [self._make_navbar_item("Join Discord", "https://discord.gg/abc123")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "discord")

	def test_linkedin_url_detected(self):
		"""Test that LinkedIn URLs are detected."""
		items = [self._make_navbar_item("LinkedIn", "https://linkedin.com/company/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "linkedin")

	def test_slack_url_detected(self):
		"""Test that Slack URLs are detected."""
		items = [self._make_navbar_item("Slack", "https://slack.com/workspace")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "slack")

	def test_facebook_url_detected(self):
		"""Test that Facebook URLs are detected."""
		items = [self._make_navbar_item("Facebook", "https://facebook.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "facebook")

	def test_instagram_url_detected(self):
		"""Test that Instagram URLs are detected."""
		items = [self._make_navbar_item("Instagram", "https://instagram.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "instagram")

	def test_reddit_url_detected(self):
		"""Test that Reddit URLs are detected."""
		items = [self._make_navbar_item("Reddit", "https://reddit.com/r/erpnext")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "reddit")

	def test_unknown_url_has_no_icon(self):
		"""Test that unknown/custom URLs have no icon assigned."""
		items = [self._make_navbar_item("Custom Link", "https://example.com")]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])
		self.assertEqual(result[0]["label"], "Custom Link")

	def test_empty_url_has_no_icon(self):
		"""Test that items with empty URL have no icon."""
		items = [self._make_navbar_item("Empty", "")]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])

	def test_none_url_has_no_icon(self):
		"""Test that items with None URL have no icon."""
		items = [self._make_navbar_item("None URL", None)]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])

	def test_preserves_open_in_new_tab(self):
		"""Test that open_in_new_tab flag is preserved."""
		items = [self._make_navbar_item("Link", "https://example.com", open_in_new_tab=True)]
		result = process_navbar_items(items)

		self.assertTrue(result[0]["open_in_new_tab"])

	def test_preserves_right_alignment(self):
		"""Test that right alignment flag is preserved."""
		items = [self._make_navbar_item("Link", "https://example.com", right=True)]
		result = process_navbar_items(items)

		self.assertTrue(result[0]["right"])

	def test_multiple_items_processed(self):
		"""Test that multiple items are all processed correctly."""
		items = [
			self._make_navbar_item("GitHub", "https://github.com/frappe"),
			self._make_navbar_item("Docs", "https://docs.frappe.io"),
			self._make_navbar_item("Discord", "https://discord.gg/frappe"),
		]
		result = process_navbar_items(items)

		self.assertEqual(len(result), 3)
		self.assertEqual(result[0]["icon"], "github")
		self.assertIsNone(result[1]["icon"])  # docs.frappe.io is not a known service
		self.assertEqual(result[2]["icon"], "discord")

	def test_empty_list(self):
		"""Test that empty list returns empty list."""
		result = process_navbar_items([])

		self.assertEqual(result, [])

	def test_subdomain_not_matched(self):
		"""Test that subdomains like api.github.com are still matched."""
		items = [self._make_navbar_item("API", "https://api.github.com/repos")]
		result = process_navbar_items(items)

		# api.github.com contains github.com so it should match
		self.assertEqual(result[0]["icon"], "github")

	def test_url_with_path_matched(self):
		"""Test that URLs with paths are correctly matched."""
		items = [
			self._make_navbar_item("Repo", "https://github.com/frappe/wiki/issues"),
			self._make_navbar_item("Video", "https://youtube.com/watch?v=abc123"),
		]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "github")
		self.assertEqual(result[1]["icon"], "youtube")


class TestSetRoute(WikiDocumentTestBase):
	"""
	Unit tests for the set_route method of WikiDocument.
	Tests route generation for nested documents to prevent path duplication.
	"""

	def test_nested_document_route_no_duplication(self):
		"""
		Test that deeply nested documents generate correct routes without path duplication.

		This is a regression test for a bug where routes were being generated as:
		documentation/documentation/doctypes/documentation/doctypes/submittable/workflows
		instead of:
		documentation/doctypes/submittable/workflows

		The bug occurred because set_route() was appending full ancestor routes
		(which already included the space prefix) instead of just ancestor slugs.
		"""
		# Create wiki space first (this auto-creates a root_group)
		space = create_test_wiki_space(self, "Documentation Space", "documentation", None)
		root_group_name = space.root_group

		# Create the document hierarchy under the space's root_group: Root -> DocTypes -> Submittable -> Workflows
		doctypes = create_test_wiki_document(
			self, "DocTypes", parent=root_group_name, is_group=True, slug="doctypes"
		)
		submittable = create_test_wiki_document(
			self, "Submittable", parent=doctypes.name, is_group=True, slug="submittable"
		)
		workflows = create_test_wiki_document(self, "Workflows", parent=submittable.name, slug="workflows")

		# Verify routes are correct without duplication
		self.assertEqual(doctypes.route, "documentation/doctypes")
		self.assertEqual(submittable.route, "documentation/doctypes/submittable")
		self.assertEqual(workflows.route, "documentation/doctypes/submittable/workflows")

		# Verify no path segment appears more than once (except as part of different segments)
		self.assertNotIn("documentation/documentation", workflows.route)
		self.assertNotIn("doctypes/doctypes", workflows.route)

	def test_route_regeneration_on_existing_document(self):
		"""
		Test that clearing and regenerating a route on an existing document
		produces the correct path without duplication.

		This specifically tests the code path where is_new() returns False
		and get_ancestors() is used instead of traversing parent_wiki_document.
		"""
		# Create wiki space first (this auto-creates a root_group)
		space = create_test_wiki_space(self, "Regen Test Space", "regen-space", None)
		root_group_name = space.root_group

		# Create the document hierarchy under the space's root_group
		parent_folder = create_test_wiki_document(
			self, "Parent Folder", parent=root_group_name, is_group=True, slug="parent"
		)
		child_doc = create_test_wiki_document(self, "Child Doc", parent=parent_folder.name, slug="child")

		# Verify initial route is correct
		self.assertEqual(child_doc.route, "regen-space/parent/child")

		# Clear route and save to trigger regeneration
		child_doc.route = None
		child_doc.save()

		# Reload and verify route is still correct
		child_doc.reload()
		self.assertEqual(child_doc.route, "regen-space/parent/child")

	def test_single_level_nesting_route(self):
		"""Test route generation for a document one level deep."""
		# Create wiki space first (this auto-creates a root_group)
		space = create_test_wiki_space(self, "Single Level Space", "single", None)
		root_group_name = space.root_group

		# Create child document under the space's root_group
		child = create_test_wiki_document(self, "Child Page", parent=root_group_name, slug="child-page")

		self.assertEqual(child.route, "single/child-page")


class TestExternalLinkExclusions(WikiDocumentTestBase):
	"""
	Tests that external link documents are excluded from search indexing
	and cannot be accessed via direct routing.
	"""

	def test_search_excludes_external_link(self):
		"""Test that external link documents do not appear in search results."""
		from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import WikiSQLiteSearch

		root_group = create_test_wiki_document(self, "Root ExtSearch", is_group=True)
		normal_page = create_test_wiki_document(
			self, "Normal Search Page", parent=root_group.name, content="unique_searchterm_abc"
		)
		create_test_wiki_document(
			self,
			"External Link Page",
			parent=root_group.name,
			is_external_link=True,
			external_url="https://example.com",
			content="unique_searchterm_abc",
		)
		create_test_wiki_space(self, "ExtSearch Space", "ext-search-space", root_group.name)

		search = WikiSQLiteSearch()
		search.drop_index()
		search.build_index()

		results = search.search("unique_searchterm_abc")
		result_names = [r["name"] for r in results["results"]]

		self.assertIn(normal_page.name, result_names)
		self.assertEqual(len(results["results"]), 1)

	def test_renderer_cannot_render_external_link(self):
		"""Test that WikiDocumentRenderer.can_render() returns False for external links."""
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import WikiDocumentRenderer

		root_group = create_test_wiki_document(self, "Root ExtRender", is_group=True)
		external_link = create_test_wiki_document(
			self,
			"External Render Link",
			parent=root_group.name,
			is_external_link=True,
			external_url="https://example.com",
			slug="ext-render-link",
		)
		create_test_wiki_space(self, "ExtRender Space", "ext-render", root_group.name)

		renderer = WikiDocumentRenderer(path=external_link.route)
		self.assertFalse(renderer.can_render())

	def test_renderer_can_render_normal_page(self):
		"""Test that WikiDocumentRenderer.can_render() returns True for normal pages."""
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import WikiDocumentRenderer

		root_group = create_test_wiki_document(self, "Root NormalRender", is_group=True)
		normal_page = create_test_wiki_document(
			self,
			"Normal Render Page",
			parent=root_group.name,
			slug="normal-render-page",
		)
		create_test_wiki_space(self, "NormalRender Space", "normal-render", root_group.name)

		renderer = WikiDocumentRenderer(path=normal_page.route)
		self.assertTrue(renderer.can_render())

	def test_renderer_refuses_the_app_route(self):
		"""The editor SPA owns /wiki-app, even against a space that claims the same route."""
		root_group = create_test_wiki_document(self, "Root AppRoute", is_group=True)
		create_test_wiki_space(self, "AppRoute Space", APP_ROUTE, root_group.name)
		page = create_test_wiki_document(
			self,
			"App Route Page",
			parent=root_group.name,
			slug="app-route-page",
		)

		self.assertEqual(page.route, f"{APP_ROUTE}/app-route-page")
		for path in (APP_ROUTE, page.route):
			with self.subTest(path=path):
				self.assertFalse(WikiDocumentRenderer(path=path).can_render())

	def test_renderer_serves_a_space_at_the_wiki_route(self):
		"""`wiki` is a user route now, not the app's -- the reader must serve it."""
		root_group = create_test_wiki_document(self, "Root WikiRoute", is_group=True)
		# Space first: a document's route is built from its space at insert time.
		create_test_wiki_space(self, "WikiRoute Space", "wiki", root_group.name)
		page = create_test_wiki_document(
			self,
			"Wiki Route Page",
			parent=root_group.name,
			slug="wiki-route-page",
		)

		self.assertEqual(page.route, "wiki/wiki-route-page")
		self.assertTrue(WikiDocumentRenderer(path=page.route).can_render())

	def test_get_page_data_raises_for_external_link(self):
		"""Test that get_page_data() raises DoesNotExistError for external links."""
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import get_page_data

		root_group = create_test_wiki_document(self, "Root ExtPageData", is_group=True)
		external_link = create_test_wiki_document(
			self,
			"External PageData Link",
			parent=root_group.name,
			is_external_link=True,
			external_url="https://example.com",
			slug="ext-pagedata-link",
		)
		create_test_wiki_space(self, "ExtPageData Space", "ext-pagedata", root_group.name)

		with self.assertRaises(frappe.DoesNotExistError):
			get_page_data(route=external_link.route)

	def test_get_page_data_works_for_normal_page(self):
		"""Test that get_page_data() works for normal published pages."""
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import get_page_data

		root_group = create_test_wiki_document(self, "Root NormalPageData", is_group=True)
		normal_page = create_test_wiki_document(
			self,
			"Normal PageData Page",
			parent=root_group.name,
			slug="normal-pagedata-page",
		)
		create_test_wiki_space(self, "NormalPageData Space", "normal-pagedata", root_group.name)

		context = get_page_data(route=normal_page.route)
		self.assertEqual(context["title"], "Normal PageData Page")


class TestContentPreservation(WikiDocumentTestBase):
	"""Server-side guarantee: raw HTML in the content field round-trips untouched.

	Locks in that none of the server paths (direct save, db.set_value, repeated
	saves) mutate iframe HTML stored on a Wiki Document. The double-escape bug
	in frappe/wiki#599 originates in the TipTap editor, not here — these tests
	pin the Python boundary so adding sanitization later can't silently
	re-introduce the same class of bug.
	"""

	IFRAME_CONTENT = (
		'<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" '
		'title="YouTube video" frameborder="0"></iframe>'
	)

	def test_iframe_content_survives_direct_save(self):
		"""A Wiki Document with an iframe embed must round-trip unchanged."""
		root_group = create_test_wiki_document(self, "Root XSS Save", is_group=True)
		page = create_test_wiki_document(
			self,
			"Iframe Page",
			parent=root_group.name,
			content=self.IFRAME_CONTENT,
		)

		page.reload()
		self.assertEqual(page.content, self.IFRAME_CONTENT)

	def test_iframe_content_survives_db_set_value(self):
		"""Merge's content-only fast path uses frappe.db.set_value — same guarantee."""
		root_group = create_test_wiki_document(self, "Root XSS SetValue", is_group=True)
		page = create_test_wiki_document(self, "Iframe SetValue Page", parent=root_group.name)

		frappe.db.set_value("Wiki Document", page.name, "content", self.IFRAME_CONTENT)

		stored = frappe.db.get_value("Wiki Document", page.name, "content")
		self.assertEqual(stored, self.IFRAME_CONTENT)

	def test_repeated_saves_do_not_compound_escape(self):
		"""Each save on a Code field must be idempotent (no cumulative mutation)."""
		root_group = create_test_wiki_document(self, "Root XSS Compound", is_group=True)
		page = create_test_wiki_document(
			self,
			"Iframe Compound Page",
			parent=root_group.name,
			content=self.IFRAME_CONTENT,
		)

		for _ in range(3):
			page.reload()
			page.save()

		page.reload()
		self.assertEqual(page.content, self.IFRAME_CONTENT)


class TestWikiDocumentPdfDownload(WikiDocumentTestBase):
	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_download_pdf_returns_pdf_for_published_public_page(self):
		root_group = create_test_wiki_document(self, "Root PDF Public", is_group=True)
		page = create_test_wiki_document(
			self,
			"Downloadable Page",
			parent=root_group.name,
			content="# Public Page\n\nThis page should download.",
			slug="downloadable-page",
		)
		# Public space: the Guest role grants anonymous read access.
		create_test_wiki_space(
			self,
			"PDF Public Space",
			"pdf-public-space",
			root_group.name,
			roles=[("Guest", "Read")],
		)

		frappe.set_user("Guest")
		frappe.local.response = frappe._dict()

		with patch(
			"wiki.frappe_wiki.doctype.wiki_document.wiki_document.get_print",
			return_value=b"%PDF-test%",
		) as mocked_get_print:
			download_pdf(route=page.route)

		mocked_get_print.assert_called_once()
		self.assertEqual(mocked_get_print.call_args.kwargs["print_format"], "Standard Wiki Document")
		self.assertEqual(frappe.local.response.type, "download")
		self.assertEqual(frappe.local.response.content_type, "application/pdf")
		self.assertEqual(frappe.local.response.filecontent, b"%PDF-test%")
		self.assertEqual(frappe.local.response.filename, "downloadable-page.pdf")

	def test_download_pdf_blocks_private_page_for_guest(self):
		# A space with no role rows is open to logged-in users only; an anonymous
		# Guest is denied and gets a 404 (existence is not leaked).
		root_group = create_test_wiki_document(self, "Root PDF Private", is_group=True)
		page = create_test_wiki_document(
			self,
			"Private Download Page",
			parent=root_group.name,
			slug="private-download-page",
		)
		create_test_wiki_space(self, "PDF Private Space", "pdf-private-space", root_group.name)

		frappe.set_user("Guest")

		with self.assertRaises(frappe.DoesNotExistError):
			download_pdf(route=page.route)

	def test_before_print_renders_markdown_content(self):
		root_group = create_test_wiki_document(self, "Root PDF Context", is_group=True)
		page = create_test_wiki_document(
			self,
			"Printable Context Page",
			parent=root_group.name,
			content="## Section\n\nParagraph text.",
			slug="printable-context-page",
		)
		create_test_wiki_space(self, "PDF Context Space", "pdf-context-space", root_group.name)

		page.before_print()

		self.assertIn("<h2", page.rendered_content_for_pdf)


def _sitemap_routes(xml: str) -> set:
	"""Routes listed in a sitemap, without the host it was served under."""
	return {urlparse(loc).path.lstrip("/") for loc in re.findall(r"<loc>([^<]+)</loc>", xml)}


def _make_request(test_client, method, path, **kwargs):
	"""Run a werkzeug test-client request in a thread (mirrors frappe test_api pattern)."""
	site = frappe.local.site

	class _T(Thread):
		_return = None

		def run(self):
			target = getattr(test_client, method)
			with patch("frappe.app.get_site_name", return_value=site):
				self._return = target(path, **kwargs)

	t = _T()
	t.start()
	t.join()
	return t._return


class TestMarkdownContentNegotiation(WikiDocumentTestBase):
	"""Tests for the Accept: text/markdown content negotiation feature."""

	TEST_CLIENT = get_test_client()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def test_accept_text_markdown_returns_raw_markdown(self):
		"""Requesting a wiki page with Accept: text/markdown returns raw markdown content."""
		markdown_content = "# Hello World\n\nThis is **bold** and *italic* text."
		route = self._unique("md-raw")
		root_group = create_test_wiki_document(self, "Root MD Test", is_group=True)
		page = create_test_wiki_document(
			self,
			"Markdown Test Page",
			parent=root_group.name,
			slug=self._unique("page"),
			content=markdown_content,
		)
		create_test_wiki_space(self, "MD Test Space", route, root_group.name, roles=[("Guest", "Read")])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{page.route}",
			headers={"Accept": "text/markdown"},
		)

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/markdown", response.headers.get("Content-Type", ""))
		self.assertEqual(response.headers.get("Vary"), "Accept")

		body = response.get_data(as_text=True)
		self.assertTrue(body.startswith("---\n"))
		self.assertIn('title: "Markdown Test Page"', body)
		self.assertTrue(body.endswith(markdown_content))

	def test_default_accept_returns_html(self):
		"""Requesting a wiki page without Accept: text/markdown returns HTML."""
		route = self._unique("md-html")
		root_group = create_test_wiki_document(self, "Root HTML Test", is_group=True)
		page = create_test_wiki_document(
			self,
			"HTML Test Page",
			parent=root_group.name,
			slug=self._unique("page"),
			content="# Some content",
		)
		create_test_wiki_space(self, "HTML Test Space", route, root_group.name, roles=[("Guest", "Read")])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{page.route}",
			headers={"Accept": "text/html"},
		)

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/html", response.headers.get("Content-Type", ""))

	def test_markdown_response_for_unpublished_page_raises_error(self):
		"""Requesting markdown for an unpublished page should return an error."""
		route = self._unique("md-unpub")
		root_group = create_test_wiki_document(self, "Root Unpub MD", is_group=True)
		page = create_test_wiki_document(
			self,
			"Unpublished MD Page",
			parent=root_group.name,
			slug=self._unique("page"),
			content="# Secret content",
		)
		create_test_wiki_space(self, "Unpub MD Space", route, root_group.name, roles=[("Guest", "Read")])

		# Unpublish after creation since validation prevents inserting unpublished pages
		frappe.db.set_value("Wiki Document", page.name, "is_published", 0)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{page.route}",
			headers={"Accept": "text/markdown"},
		)

		self.assertNotEqual(response.status_code, 200)

	def test_markdown_response_has_utf8_charset(self):
		"""Markdown response should specify UTF-8 charset."""
		route = self._unique("md-charset")
		root_group = create_test_wiki_document(self, "Root Charset", is_group=True)
		page = create_test_wiki_document(
			self,
			"Charset Test Page",
			parent=root_group.name,
			slug=self._unique("page"),
			content="# Unicode: éèê",
		)
		create_test_wiki_space(self, "Charset Space", route, root_group.name, roles=[("Guest", "Read")])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(
			self.TEST_CLIENT,
			"get",
			f"/{page.route}",
			headers={"Accept": "text/markdown"},
		)

		self.assertEqual(response.status_code, 200)
		content_type = response.headers.get("Content-Type", "")
		self.assertIn("charset=utf-8", content_type)


class TestCrawlerEndpoints(WikiDocumentTestBase):
	"""Tests for the crawler-facing routes served by CrawlerRenderer."""

	TEST_CLIENT = get_test_client()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def _make_space(self, label, guest_readable=True, content="# Page\n\nBody text.", published=True):
		"""A one-page space, returning (space, page)."""
		root_group = create_test_wiki_document(self, f"Root {label}", is_group=True)
		page = create_test_wiki_document(
			self,
			f"Page {label}",
			parent=root_group.name,
			slug=self._unique("page"),
			content=content,
		)
		space = create_test_wiki_space(
			self,
			f"Space {label}",
			self._unique("crawl"),
			root_group.name,
			roles=[("Guest", "Read")] if guest_readable else [],
		)
		if not published:
			frappe.db.set_value("Wiki Document", page.name, "is_published", 0)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		return space, page

	def test_md_route_returns_markdown_with_frontmatter(self):
		_, page = self._make_space("MD Route", content="# Title\n\nSome **body**.")

		response = _make_request(self.TEST_CLIENT, "get", f"/{page.route}.md")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/markdown", response.headers.get("Content-Type", ""))
		self.assertIn("private", response.headers.get("Cache-Control", ""))

		body = response.get_data(as_text=True)
		self.assertIn(f'title: "{page.title}"', body)
		self.assertIn(f'/{page.route}"', body)
		self.assertTrue(body.endswith("# Title\n\nSome **body**."))

	def test_md_route_for_unpublished_page_is_not_found(self):
		_, page = self._make_space("MD Unpublished", published=False)

		response = _make_request(self.TEST_CLIENT, "get", f"/{page.route}.md")

		self.assertEqual(response.status_code, 404)

	def test_md_route_in_restricted_space_is_not_found_for_guest(self):
		_, page = self._make_space("MD Restricted", guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", f"/{page.route}.md")

		self.assertEqual(response.status_code, 404)

	def test_space_md_route_redirects_to_first_page_markdown(self):
		space, page = self._make_space("MD Space Redirect")

		response = _make_request(self.TEST_CLIENT, "get", f"/{space.route}.md")

		self.assertEqual(response.status_code, 301)
		self.assertTrue(response.headers["Location"].endswith(f"/{page.route}.md"))

	def test_space_md_route_does_not_leak_a_restricted_first_page(self):
		"""The redirect must not name a private route to a visitor who can't read it."""
		space, page = self._make_space("MD Restricted Redirect", guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", f"/{space.route}.md")

		self.assertEqual(response.status_code, 404)
		self.assertNotIn(page.route, response.headers.get("Location", ""))

	def test_space_html_route_does_not_leak_a_restricted_first_page(self):
		"""Same for the reader's own redirect, which shares the resolver."""
		space, page = self._make_space("HTML Restricted Redirect", guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", f"/{space.route}")

		self.assertEqual(response.status_code, 404)
		self.assertNotIn(page.route, response.headers.get("Location", ""))

	def test_page_routed_with_md_suffix_still_renders_html(self):
		"""A page legitimately slugged "<name>.md" keeps its own URL as HTML."""
		root_group = create_test_wiki_document(self, "Root MD Slug", is_group=True)
		page = create_test_wiki_document(
			self,
			"Literal MD Page",
			parent=root_group.name,
			slug=self._unique("readme") + ".md",
			content="# Literal",
		)
		create_test_wiki_space(
			self, "MD Slug Space", self._unique("crawl"), root_group.name, roles=[("Guest", "Read")]
		)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(self.TEST_CLIENT, "get", f"/{page.route}")

		self.assertEqual(response.status_code, 200)
		# Content-Type is guessed from the ".md" path by frappe's build_response,
		# so the body is what tells the two representations apart here.
		self.assertTrue(response.get_data(as_text=True).lstrip().startswith("<!DOCTYPE html"))

		markdown = _make_request(self.TEST_CLIENT, "get", f"/{page.route}.md")

		self.assertEqual(markdown.status_code, 200)
		self.assertIn("text/markdown", markdown.headers.get("Content-Type", ""))
		self.assertTrue(markdown.get_data(as_text=True).startswith("---\n"))


class TestSpaceLlmsTxt(WikiDocumentTestBase):
	"""Tests for the per-space /<space>/llms.txt index."""

	TEST_CLIENT = get_test_client()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def assertEntry(self, lines, route, prefix, suffix=""):
		"""Assert one list entry links to `route` and has the expected shape.

		The absolute URLs in these files carry whatever host the request ran
		against — `localhost` in CI, `localhost:8000` on a dev bench — so the
		entry is found by route and only its ends are asserted.
		"""
		matches = [line for line in lines if f"/{route}.md)" in line]
		self.assertEqual(len(matches), 1, f"expected exactly one entry for {route}, got {matches}")
		entry = matches[0]
		self.assertTrue(entry.startswith(prefix), f"{entry!r} does not start with {prefix!r}")
		self.assertTrue(entry.endswith(suffix), f"{entry!r} does not end with {suffix!r}")

	def _space_with_tree(self, guest_readable=True):
		"""A space with untabbed content, a tab, a nested group and a draft page."""
		root_group = create_test_wiki_document(self, "Root Llms", is_group=True)
		# The space comes first: `is_tab` validates against the space's root group.
		space = create_test_wiki_space(
			self,
			"Llms Space",
			self._unique("llms-space"),
			root_group.name,
			roles=[("Guest", "Read")] if guest_readable else [],
		)

		intro = create_test_wiki_document(
			self, "Introduction", parent=root_group.name, slug=self._unique("intro")
		)
		intro.meta_description = "What this is."
		intro.save()

		tab = create_test_wiki_document(self, "API Reference", parent=root_group.name, is_group=True)
		tab.is_tab = 1
		tab.save()
		endpoints = create_test_wiki_document(
			self, "Endpoints", parent=tab.name, slug=self._unique("endpoints")
		)

		nested_group = create_test_wiki_document(self, "Internals", parent=tab.name, is_group=True)
		nested = create_test_wiki_document(
			self, "Nested Page", parent=nested_group.name, slug=self._unique("nested")
		)

		draft = create_test_wiki_document(
			self, "Draft Page", parent=root_group.name, slug=self._unique("draft")
		)

		frappe.db.set_value("Wiki Document", draft.name, "is_published", 0)
		clear_wiki_tree_cache()
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		return frappe._dict(
			space=space,
			intro=intro,
			endpoints=endpoints,
			nested=nested,
			nested_group=nested_group,
			draft=draft,
		)

	def test_space_llms_txt_mirrors_the_sidebar(self):
		tree = self._space_with_tree()

		response = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/plain", response.headers.get("Content-Type", ""))
		self.assertIn("public", response.headers.get("Cache-Control", ""))

		body = response.get_data(as_text=True)
		lines = body.splitlines()

		self.assertEqual(lines[0], "# Llms Space")
		self.assertIn("> What this is.", lines)
		self.assertIn("## Home", lines)
		self.assertIn("## API Reference", lines)

		# Untabbed top-level content lands under Home, tabbed content under its tab.
		self.assertEntry(lines, tree.intro.route, "- [Introduction](", "): What this is.")
		self.assertEntry(lines, tree.endpoints.route, "- [Endpoints](", ")")

		# A group has no page of its own, so it is a label; its children indent under it.
		self.assertIn("- **Internals**", lines)
		self.assertEntry(lines, tree.nested.route, "  - [Nested Page](", ")")

	def test_space_llms_txt_omits_unpublished_pages(self):
		tree = self._space_with_tree()

		response = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt")

		self.assertNotIn("Draft Page", response.get_data(as_text=True))

	def test_space_llms_txt_links_only_to_markdown(self):
		tree = self._space_with_tree()

		body = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt").get_data(as_text=True)

		links = re.findall(r"\]\((http[^)]+)\)", body)
		self.assertTrue(links)
		for link in links:
			self.assertTrue(link.endswith(".md"), f"{link} is not a markdown link")

	def test_space_llms_txt_escapes_editor_controlled_text(self):
		"""A title or description is free text; it must not rewrite the index."""
		tree = self._space_with_tree()

		hostile = create_test_wiki_document(
			self,
			"Click ](https://evil.example) here",
			parent=tree.space.root_group,
			slug=self._unique("hostile"),
		)
		hostile.meta_description = "First line\n- [Injected](https://evil.example/inject.md)"
		hostile.save()
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		body = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt").get_data(as_text=True)

		self.assertEntry(body.splitlines(), hostile.route, "- [Click \\](https://evil.example) here](")
		self.assertIn("Click \\](https://evil.example) here", body)
		# The multiline description collapses instead of becoming its own entry.
		self.assertNotIn("\n- [Injected]", body)
		for line in body.splitlines():
			self.assertFalse(line.startswith("- [Injected]"))

	def test_space_llms_txt_is_not_found_for_a_restricted_space(self):
		tree = self._space_with_tree(guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt")

		self.assertEqual(response.status_code, 404)

	def test_site_llms_txt_lists_public_spaces_only(self):
		public = self._space_with_tree()
		restricted = self._space_with_tree(guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", "/llms.txt")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/plain", response.headers.get("Content-Type", ""))

		body = response.get_data(as_text=True)
		self.assertTrue(body.startswith("# "))
		self.assertIn("## Spaces", body)
		self.assertIn(f"/{public.space.route}/llms.txt)", body)
		self.assertNotIn(f"/{restricted.space.route}/llms.txt", body)

	def test_site_llms_txt_survives_a_space_whose_root_group_is_gone(self):
		"""One broken space must not take the whole site index down."""
		public = self._space_with_tree()
		orphan = create_test_wiki_space(
			self, "Orphan Space", self._unique("orphan"), None, roles=[("Guest", "Read")]
		)
		frappe.db.set_value("Wiki Space", orphan.name, "root_group", self._unique("gone"))
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		response = _make_request(self.TEST_CLIENT, "get", "/llms.txt")

		self.assertEqual(response.status_code, 200)
		self.assertIn(f"/{public.space.route}/llms.txt", response.get_data(as_text=True))

		space_response = _make_request(self.TEST_CLIENT, "get", f"/{orphan.route}/llms.txt")

		self.assertEqual(space_response.status_code, 404)

	def test_indexes_are_rebuilt_after_a_page_is_added(self):
		"""The cached index must not outlive the wiki it describes."""
		tree = self._space_with_tree()

		_make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt")

		added = create_test_wiki_document(
			self, "Added Later", parent=tree.space.root_group, slug=self._unique("added")
		)
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		body = _make_request(self.TEST_CLIENT, "get", f"/{tree.space.route}/llms.txt").get_data(as_text=True)
		self.assertIn(f"/{added.route}.md", body)

		sitemap = _make_request(self.TEST_CLIENT, "get", "/sitemap.xml").get_data(as_text=True)
		self.assertIn(added.route, _sitemap_routes(sitemap))

	def test_site_index_is_rebuilt_when_a_space_is_added(self):
		self._space_with_tree()

		_make_request(self.TEST_CLIENT, "get", "/llms.txt")

		added = self._space_with_tree()

		body = _make_request(self.TEST_CLIENT, "get", "/llms.txt").get_data(as_text=True)
		self.assertIn(f"/{added.space.route}/llms.txt", body)

	def test_sitemap_lists_public_wiki_routes_only(self):
		public = self._space_with_tree()
		restricted = self._space_with_tree(guest_readable=False)

		response = _make_request(self.TEST_CLIENT, "get", "/sitemap.xml")

		self.assertEqual(response.status_code, 200)
		self.assertIn("xml", response.headers.get("Content-Type", ""))

		body = response.get_data(as_text=True)
		routes = _sitemap_routes(body)

		# Parses, and every entry is a page — not a group, a draft or a `.md` twin.
		ElementTree.fromstring(body)
		self.assertIn(public.intro.route, routes)
		self.assertIn(public.nested.route, routes)
		self.assertNotIn(public.draft.route, routes)
		self.assertNotIn(restricted.intro.route, routes)
		self.assertFalse([route for route in routes if route.endswith(".md")])
		self.assertNotIn(
			public.nested_group.route,
			routes,
			"groups are not served at their own route",
		)


class TestStale404CacheInvalidation(WikiDocumentTestBase):
	"""
	Regression tests for GH-684: Frappe caches every guest URL that 404s
	(the ``website_404`` cache) and short-circuits later requests to it, so a
	page published or renamed after its URL was visited kept returning 404
	until the cache was cleared manually. Wiki Document writes must invalidate
	that cache.
	"""

	def setUp(self):
		self._original_request = getattr(frappe.local, "request", None)
		frappe.cache.delete_value("website_404")

	def tearDown(self):
		if self._original_request is not None:
			frappe.local.request = self._original_request
		elif hasattr(frappe.local, "request"):
			del frappe.local.request
		super().tearDown()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def _poison_404_cache(self, route):
		"""Simulate NotFoundPage caching a guest 404 hit for this URL."""
		from werkzeug.test import EnvironBuilder
		from werkzeug.wrappers import Request

		builder = EnvironBuilder(path=f"/{route}", base_url=frappe.utils.get_url())
		frappe.local.request = Request(builder.get_environ())
		frappe.cache.hset("website_404", frappe.local.request.url, True)

	def _resolve(self, route):
		"""Resolve a route the way a web request would, with 404 caching active."""
		from frappe.website.path_resolver import PathResolver

		with patch("frappe.website.path_resolver.can_cache", return_value=True):
			return PathResolver(route).resolve()[1]

	def _create_space(self, prefix):
		route = self._unique(prefix)
		space = create_test_wiki_space(self, f"Space {route}", route, None, roles=[("Guest", "Read")])
		return space, route

	def test_publishing_new_page_clears_cached_404(self):
		from frappe.website.page_renderers.not_found_page import NotFoundPage

		space, space_route = self._create_space("cache-684")
		slug = self._unique("page")
		route = f"{space_route}/{slug}"

		self._poison_404_cache(route)
		self.assertIsInstance(self._resolve(route), NotFoundPage)

		create_test_wiki_document(self, "Cache Test Page", parent=space.root_group, slug=slug)

		self.assertIsInstance(self._resolve(route), WikiDocumentRenderer)

	def test_route_change_clears_cached_404_for_new_route(self):
		from frappe.website.page_renderers.not_found_page import NotFoundPage

		space, space_route = self._create_space("cache-684-mv")
		doc = create_test_wiki_document(self, "Move Me", parent=space.root_group, slug=self._unique("old"))
		new_slug = self._unique("new")
		new_route = f"{space_route}/{new_slug}"

		self._poison_404_cache(new_route)
		self.assertIsInstance(self._resolve(new_route), NotFoundPage)

		doc.slug = new_slug
		doc.route = new_route
		doc.save()

		self.assertIsInstance(self._resolve(new_route), WikiDocumentRenderer)

	def test_publish_toggle_clears_cached_404(self):
		space, space_route = self._create_space("cache-684-pub")
		slug = self._unique("draft")
		doc = create_test_wiki_document(
			self, "Draft Page", parent=space.root_group, slug=slug, is_published=False
		)
		route = f"{space_route}/{slug}"

		self._poison_404_cache(route)

		doc.is_published = 1
		doc.save()

		self.assertIsInstance(self._resolve(route), WikiDocumentRenderer)

	def test_space_route_rename_clears_cached_404(self):
		space, space_route = self._create_space("cache-684-sp")
		slug = self._unique("page")
		doc = create_test_wiki_document(self, "Space Rename Page", parent=space.root_group, slug=slug)

		new_space_route = self._unique("cache-684-renamed")
		new_route = f"{new_space_route}/{slug}"

		self._poison_404_cache(new_route)

		space.reload()
		space.update_routes(new_space_route)

		doc.reload()
		self.assertEqual(doc.route, new_route)
		self.assertIsInstance(self._resolve(new_route), WikiDocumentRenderer)


class TestSpaceUrlFirstPage(WikiDocumentTestBase):
	"""The space URL must land on the first page in sidebar order (sort_order),
	not the first descendant in NestedSet (lft) order."""

	def test_first_page_follows_sidebar_sort_order_not_lft(self):
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import get_first_published_page

		root = create_test_wiki_document(self, "FirstPage Root", is_group=True)
		# Created first, so it has the lower lft — but reordered last in the sidebar.
		created_first = create_test_wiki_document(
			self, "Created First", parent=root.name, slug="fp-created-first"
		)
		sidebar_first = create_test_wiki_document(
			self, "Sidebar First", parent=root.name, slug="fp-sidebar-first"
		)
		create_test_wiki_space(self, "FirstPage Space", "fp-space", root.name)
		# Raw sort_order writes, exactly like reorder_wiki_documents does.
		frappe.db.set_value("Wiki Document", sidebar_first.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", created_first.name, "sort_order", 1)

		first = get_first_published_page(root.name)
		self.assertEqual(first["route"], sidebar_first.route)

	def test_first_page_descends_into_first_group(self):
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import get_first_published_page

		root = create_test_wiki_document(self, "FirstPage GRoot", is_group=True)
		later = create_test_wiki_document(self, "Later Page", parent=root.name, slug="fpg-later")
		group = create_test_wiki_document(
			self, "First Group", parent=root.name, is_group=True, slug="fpg-group"
		)
		nested = create_test_wiki_document(self, "Nested Page", parent=group.name, slug="fpg-nested")
		create_test_wiki_space(self, "FirstPage GSpace", "fpg-space", root.name)
		frappe.db.set_value("Wiki Document", group.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", later.name, "sort_order", 1)

		first = get_first_published_page(root.name)
		self.assertEqual(first["route"], nested.route)

	def test_first_page_skips_unpublished_and_external(self):
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import get_first_published_page

		root = create_test_wiki_document(self, "FirstPage SRoot", is_group=True)
		create_test_wiki_document(
			self, "Unpublished", parent=root.name, sort_order=0, slug="fps-unpub", is_published=False
		)
		create_test_wiki_document(
			self,
			"External",
			parent=root.name,
			sort_order=1,
			slug="fps-ext",
			is_external_link=True,
			external_url="https://example.com",
		)
		page = create_test_wiki_document(self, "Real Page", parent=root.name, sort_order=2, slug="fps-real")
		create_test_wiki_space(self, "FirstPage SSpace", "fps-space", root.name)

		first = get_first_published_page(root.name)
		self.assertEqual(first["route"], page.route)

	def test_space_route_redirects_to_first_sidebar_page(self):
		root = create_test_wiki_document(self, "FirstPage RRoot", is_group=True)
		later = create_test_wiki_document(self, "Redirect Later", parent=root.name, slug="fpr-later")
		target = create_test_wiki_document(self, "Redirect Target", parent=root.name, slug="fpr-target")
		create_test_wiki_space(self, "FirstPage RSpace", "fpr-space", root.name)
		frappe.db.set_value("Wiki Document", target.name, "sort_order", 0)
		frappe.db.set_value("Wiki Document", later.name, "sort_order", 1)

		renderer = WikiDocumentRenderer(path="fpr-space")
		with self.assertRaises(frappe.Redirect):
			renderer.can_render()
		self.assertEqual(frappe.local.flags.redirect_location, "/" + target.route)


class TestWikiTreeCache(WikiDocumentTestBase):
	def test_tree_is_cached_and_busted_on_document_update(self):
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
			WIKI_TREE_CACHE_KEY,
			get_public_wiki_tree,
		)

		root = create_test_wiki_document(self, "TreeCache Root", is_group=True)
		page = create_test_wiki_document(self, "TreeCache Page", parent=root.name, slug="tc-page")
		create_test_wiki_space(self, "TreeCache Space", "tc-space", root.name)

		tree = get_public_wiki_tree(root.name)
		self.assertEqual(tree[0]["title"], "TreeCache Page")
		self.assertIsNotNone(frappe.cache().hget(WIKI_TREE_CACHE_KEY, root.name))

		page.title = "TreeCache Page Renamed"
		page.save()

		self.assertIsNone(frappe.cache().hget(WIKI_TREE_CACHE_KEY, root.name))
		tree = get_public_wiki_tree(root.name)
		self.assertEqual(tree[0]["title"], "TreeCache Page Renamed")

	def test_tree_cache_busted_on_reorder(self):
		from wiki.api.wiki_space import reorder_wiki_documents
		from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
			WIKI_TREE_CACHE_KEY,
			get_public_wiki_tree,
		)

		root = create_test_wiki_document(self, "TreeCache RRoot", is_group=True)
		page_a = create_test_wiki_document(self, "Reorder A", parent=root.name, sort_order=0, slug="tcr-a")
		page_b = create_test_wiki_document(self, "Reorder B", parent=root.name, sort_order=1, slug="tcr-b")
		create_test_wiki_space(self, "TreeCache RSpace", "tcr-space", root.name)

		tree = get_public_wiki_tree(root.name)
		self.assertEqual([n["title"] for n in tree], ["Reorder A", "Reorder B"])

		reorder_wiki_documents(
			doc_name=page_b.name,
			new_parent=root.name,
			new_index=0,
			siblings=json.dumps([page_b.name, page_a.name]),
		)

		self.assertIsNone(frappe.cache().hget(WIKI_TREE_CACHE_KEY, root.name))
		tree = get_public_wiki_tree(root.name)
		self.assertEqual([n["title"] for n in tree], ["Reorder B", "Reorder A"])


class TestSearchPublishGating(WikiDocumentTestBase):
	"""
	Search must mirror page-render visibility: no hits from unpublished
	spaces, and unpublishing a page must drop it from results immediately
	(not after the 5-minute index queue catches up).
	"""

	def _build_index(self):
		from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import WikiSQLiteSearch

		search = WikiSQLiteSearch()
		search.drop_index()
		search.build_index()
		return search

	def test_search_hides_docs_in_unpublished_space(self):
		from wiki.frappe_wiki.doctype.wiki_document.search import search as wiki_search

		visible_root = create_test_wiki_document(self, "Root PubSpace", is_group=True)
		create_test_wiki_space(self, "Published Space", "pub-space-gate", visible_root.name)
		visible_page = create_test_wiki_document(
			self, "Visible Page", parent=visible_root.name, content="spacegate_searchterm"
		)

		hidden_root = create_test_wiki_document(self, "Root UnpubSpace", is_group=True)
		create_test_wiki_space(
			self, "Unpublished Space", "unpub-space-gate", hidden_root.name, is_published=False
		)
		hidden_page = create_test_wiki_document(
			self, "Hidden Page", parent=hidden_root.name, content="spacegate_searchterm"
		)

		self._build_index()

		result = wiki_search("spacegate_searchterm")
		result_names = [r["name"] for r in result["results"]]

		self.assertIn(visible_page.name, result_names)
		self.assertNotIn(hidden_page.name, result_names)

	def test_unpublish_drops_doc_from_search_immediately(self):
		from wiki.frappe_wiki.doctype.wiki_document.search import search as wiki_search

		root = create_test_wiki_document(self, "Root UnpubDoc", is_group=True)
		page = create_test_wiki_document(
			self, "Soon Unpublished", parent=root.name, content="unpubdoc_searchterm"
		)
		create_test_wiki_space(self, "UnpubDoc Space", "unpub-doc-gate", root.name)

		search = self._build_index()

		result = wiki_search("unpubdoc_searchterm")
		self.assertIn(page.name, [r["name"] for r in result["results"]])

		page.reload()
		page.is_published = 0
		page.save()

		def index_row_count():
			rows = search.sql(
				"SELECT count(*) AS c FROM search_fts WHERE doc_id = ?",
				(f"Wiki Document:{page.name}",),
				read_only=True,
			)
			return rows[0]["c"]

		# Removal is deferred until the transaction commits, so the row must
		# survive a save that could still roll back.
		self.assertEqual(index_row_count(), 1)

		# Run the post-commit callbacks without committing (keeps test isolation).
		frappe.db.after_commit.run()

		# No queue processing in between: the index row must already be gone.
		self.assertEqual(index_row_count(), 0)

		result = wiki_search("unpubdoc_searchterm")
		self.assertNotIn(page.name, [r["name"] for r in result["results"]])

	def test_unpublish_index_removal_discarded_on_rollback(self):
		root = create_test_wiki_document(self, "Root RollbackDoc", is_group=True)
		page = create_test_wiki_document(
			self, "Rollback Page", parent=root.name, content="rollbackterm_search"
		)
		create_test_wiki_space(self, "Rollback Space", "unpub-rollback-gate", root.name)

		search = self._build_index()

		page.reload()
		page.is_published = 0
		page.save()

		# The save never commits: the page stays published in the database, so
		# its index row must survive too.
		frappe.db.rollback()

		rows = search.sql(
			"SELECT count(*) AS c FROM search_fts WHERE doc_id = ?",
			(f"Wiki Document:{page.name}",),
			read_only=True,
		)
		self.assertEqual(rows[0]["c"], 1)


class TestTabValidation(WikiDocumentTestBase):
	"""`is_tab` is only meaningful on a top-level group — enforce both halves.

	A leaf tab or a nested tab has nowhere to render, so the tab bar would drop
	it silently. These reject at validate so the bad state never lands.
	"""

	def _space(self):
		root_group = create_test_wiki_document(self, "Tab Root", is_group=True)
		space = create_test_wiki_space(
			self, "Tab Space", f"tab-space-{frappe.generate_hash(length=6)}", root_group.name
		)
		return space, root_group

	def test_top_level_group_can_be_a_tab(self):
		space, root_group = self._space()

		tab = create_test_wiki_document(self, "Accounting", parent=root_group.name, is_group=True)
		tab.is_tab = 1
		tab.tab_icon = "lucide-wallet"
		tab.save()

		self.assertEqual(frappe.db.get_value("Wiki Document", tab.name, "is_tab"), 1)
		self.assertEqual(frappe.db.get_value("Wiki Document", tab.name, "tab_icon"), "lucide-wallet")

	def test_leaf_cannot_be_a_tab(self):
		space, root_group = self._space()

		leaf = create_test_wiki_document(self, "A Page", parent=root_group.name)
		leaf.is_tab = 1

		with self.assertRaises(frappe.ValidationError):
			leaf.save()

	def test_nested_group_cannot_be_a_tab(self):
		space, root_group = self._space()

		outer = create_test_wiki_document(self, "Outer", parent=root_group.name, is_group=True)
		inner = create_test_wiki_document(self, "Inner", parent=outer.name, is_group=True)
		inner.is_tab = 1

		with self.assertRaises(frappe.ValidationError):
			inner.save()

	def test_clearing_is_group_on_a_tab_is_rejected(self):
		space, root_group = self._space()

		tab = create_test_wiki_document(self, "Selling", parent=root_group.name, is_group=True)
		tab.is_tab = 1
		tab.save()

		tab.is_group = 0
		with self.assertRaises(frappe.ValidationError):
			tab.save()

	def test_reparenting_a_tab_below_top_level_is_rejected(self):
		space, root_group = self._space()

		tab = create_test_wiki_document(self, "Stock", parent=root_group.name, is_group=True)
		tab.is_tab = 1
		tab.save()
		other = create_test_wiki_document(self, "Other", parent=root_group.name, is_group=True)

		tab.parent_wiki_document = other.name
		with self.assertRaises(frappe.ValidationError):
			tab.save()

	def test_reorder_api_rejects_moving_a_tab_off_top_level(self):
		"""The reorder endpoint writes parent_wiki_document with a raw db.set_value,
		so validate never runs — it needs its own copy of the guard."""
		import json

		from wiki.api.wiki_space import reorder_wiki_documents

		space, root_group = self._space()
		tab = create_test_wiki_document(self, "Manufacturing", parent=root_group.name, is_group=True)
		tab.is_tab = 1
		tab.save()
		other = create_test_wiki_document(self, "Bucket", parent=root_group.name, is_group=True)

		with self.assertRaises(frappe.ValidationError):
			reorder_wiki_documents(tab.name, other.name, 0, json.dumps([tab.name]))


class TestGetSpaceTabs(WikiDocumentTestBase):
	"""`get_space_tabs` feeds the horizontal tab bar: ordering + landing target."""

	def _space(self):
		root_group = create_test_wiki_document(self, "Tabs Root", is_group=True)
		space = create_test_wiki_space(
			self, "Tabs Space", f"tabs-space-{frappe.generate_hash(length=6)}", root_group.name
		)
		return space, root_group

	def _make_tab(self, root_group, title, icon=None, sort_order=0):
		tab = create_test_wiki_document(
			self, title, parent=root_group.name, is_group=True, sort_order=sort_order
		)
		tab.is_tab = 1
		tab.tab_icon = icon
		tab.save()
		return tab

	def test_returns_empty_for_a_space_without_tabs(self):
		space, root_group = self._space()
		create_test_wiki_document(self, "Plain group", parent=root_group.name, is_group=True)

		self.assertEqual(get_space_tabs(space.name), [])

	def test_returns_tabs_in_sort_order_with_icons(self):
		space, root_group = self._space()
		second = self._make_tab(root_group, "Selling", icon="lucide-tag", sort_order=2)
		first = self._make_tab(root_group, "Accounting", icon="lucide-wallet", sort_order=1)
		create_test_wiki_document(self, "Invoice", parent=first.name)
		create_test_wiki_document(self, "Quotation", parent=second.name)

		tabs = get_space_tabs(space.name)

		self.assertEqual([t["title"] for t in tabs], ["Accounting", "Selling"])
		self.assertEqual([t["tab_icon"] for t in tabs], ["lucide-wallet", "lucide-tag"])

	def test_non_tab_top_level_groups_are_excluded(self):
		space, root_group = self._space()
		tab = self._make_tab(root_group, "Accounting")
		create_test_wiki_document(self, "Invoice", parent=tab.name)
		plain = create_test_wiki_document(self, "Not a tab", parent=root_group.name, is_group=True)
		create_test_wiki_document(self, "Some page", parent=plain.name)

		# The plain group is untabbed content, so Home leads; it is never itself
		# listed as a tab.
		self.assertEqual([t["title"] for t in get_space_tabs(space.name)], ["Home", "Accounting"])

	def test_landing_route_falls_back_to_first_published_leaf(self):
		space, root_group = self._space()
		tab = self._make_tab(root_group, "Accounting")
		group = create_test_wiki_document(self, "Receivables", parent=tab.name, is_group=True, sort_order=0)
		first = create_test_wiki_document(self, "Invoice", parent=group.name, sort_order=0)
		create_test_wiki_document(self, "Credit Note", parent=group.name, sort_order=1)

		tabs = get_space_tabs(space.name)
		self.assertEqual(tabs[0]["landing_route"], first.route)

	def test_landing_route_prefers_a_page_at_the_tab_s_own_route(self):
		"""The README/index case: a published leaf sharing the group's route."""
		space, root_group = self._space()
		tab = self._make_tab(root_group, "Accounting")
		create_test_wiki_document(self, "Invoice", parent=tab.name)

		index = create_test_wiki_document(self, "Overview", parent=tab.name)
		index.route = tab.route
		index.save()

		tabs = get_space_tabs(space.name)
		self.assertEqual(tabs[0]["landing_route"], tab.route)

	def test_unpublished_tab_is_excluded(self):
		space, root_group = self._space()
		tab = self._make_tab(root_group, "Draft Area")
		create_test_wiki_document(self, "Page", parent=tab.name)
		frappe.db.set_value("Wiki Document", tab.name, "is_published", 0)

		self.assertEqual(get_space_tabs(space.name), [])

	def test_public_tree_carries_the_tab_fields(self):
		space, root_group = self._space()
		tab = self._make_tab(root_group, "Accounting", icon="lucide-wallet")
		create_test_wiki_document(self, "Invoice", parent=tab.name)

		node = next(n for n in get_public_wiki_tree(root_group.name) if n["name"] == tab.name)
		self.assertEqual(node["is_tab"], 1)
		self.assertEqual(node["tab_icon"], "lucide-wallet")

	def test_home_leads_the_bar_when_multiple_tabs_have_untabbed_content(self):
		space, root_group = self._space()
		accounting = self._make_tab(root_group, "Accounting", sort_order=1)
		selling = self._make_tab(root_group, "Selling", sort_order=2)
		create_test_wiki_document(self, "Invoice", parent=accounting.name)
		create_test_wiki_document(self, "Quotation", parent=selling.name)
		misc = create_test_wiki_document(
			self, "Release Notes", parent=root_group.name, is_group=True, sort_order=3
		)
		changelog = create_test_wiki_document(self, "Changelog", parent=misc.name)

		tabs = get_space_tabs(space.name)
		self.assertEqual(tabs[0]["doc_key"], "__general__")
		self.assertEqual(tabs[0]["title"], "Home")
		self.assertEqual(tabs[0]["tab_icon"], "lucide-house")
		self.assertEqual(tabs[0]["landing_route"], changelog.route)
		self.assertEqual([t["title"] for t in tabs[1:]], ["Accounting", "Selling"])

	def test_home_leads_the_bar_with_a_single_tab_and_untabbed_content(self):
		space, root_group = self._space()
		accounting = self._make_tab(root_group, "Accounting")
		create_test_wiki_document(self, "Invoice", parent=accounting.name)
		misc = create_test_wiki_document(self, "Release Notes", parent=root_group.name, is_group=True)
		changelog = create_test_wiki_document(self, "Changelog", parent=misc.name)

		tabs = get_space_tabs(space.name)
		self.assertEqual([t["title"] for t in tabs], ["Home", "Accounting"])
		self.assertEqual(tabs[0]["landing_route"], changelog.route)

	def test_home_tab_uses_the_space_title_and_icon(self):
		space, root_group = self._space()
		accounting = self._make_tab(root_group, "Accounting")
		create_test_wiki_document(self, "Invoice", parent=accounting.name)
		misc = create_test_wiki_document(self, "Release Notes", parent=root_group.name, is_group=True)
		create_test_wiki_document(self, "Changelog", parent=misc.name)
		frappe.db.set_value(
			"Wiki Space",
			space.name,
			{"home_tab_title": "Overview", "home_tab_icon": "lucide-compass"},
		)

		home = get_space_tabs(space.name)[0]
		self.assertEqual(home["doc_key"], "__general__")
		self.assertEqual(home["title"], "Overview")
		self.assertEqual(home["tab_icon"], "lucide-compass")

	def test_no_home_tab_when_the_space_is_fully_tabbed(self):
		space, root_group = self._space()
		accounting = self._make_tab(root_group, "Accounting", sort_order=1)
		selling = self._make_tab(root_group, "Selling", sort_order=2)
		create_test_wiki_document(self, "Invoice", parent=accounting.name)
		create_test_wiki_document(self, "Quotation", parent=selling.name)

		tabs = get_space_tabs(space.name)
		self.assertTrue(all(t["doc_key"] != "__general__" for t in tabs))
		self.assertEqual([t["title"] for t in tabs], ["Accounting", "Selling"])

	def test_tab_with_no_published_pages_is_excluded(self):
		space, root_group = self._space()
		accounting = self._make_tab(root_group, "Accounting", sort_order=1)
		create_test_wiki_document(self, "Invoice", parent=accounting.name)
		# An empty tab (no children) and a tab whose only page is unpublished
		# both have nothing to show, so neither appears on the public bar.
		self._make_tab(root_group, "Empty", sort_order=2)
		drafts = self._make_tab(root_group, "Drafts", sort_order=3)
		draft_page = create_test_wiki_document(self, "WIP", parent=drafts.name)
		frappe.db.set_value("Wiki Document", draft_page.name, "is_published", 0)

		self.assertEqual([t["title"] for t in get_space_tabs(space.name)], ["Accounting"])


class TestRenderedContentCache(WikiDocumentTestBase):
	"""Per-document rendered HTML + TOC caching (get_rendered_content)."""

	def test_caches_by_document_name(self):
		doc = create_test_wiki_document(self, "Cache Page", content="# Hello\n\nfirst")
		clear_wiki_content_cache(doc.name)

		html, _ = get_rendered_content(doc.name, "# Hello\n\nfirst")
		self.assertIn("first", html)

		# A second call with different content but the same name returns the
		# cached render — proving the lookup is keyed by name, not content.
		cached_html, _ = get_rendered_content(doc.name, "# Hello\n\ncompletely different")
		self.assertEqual(cached_html, html)
		self.assertNotIn("completely different", cached_html)

	def test_matches_direct_render(self):
		doc = create_test_wiki_document(self, "Parity Page", content="## Heading\n\nbody")
		clear_wiki_content_cache(doc.name)

		html, toc = get_rendered_content(doc.name, "## Heading\n\nbody")
		direct_html, direct_toc = render_markdown_with_toc("## Heading\n\nbody")
		self.assertEqual(html, direct_html)
		self.assertEqual(toc, direct_toc)

	def test_clear_invalidates(self):
		doc = create_test_wiki_document(self, "Invalidate Page", content="v1")
		get_rendered_content(doc.name, "v1")
		self.assertIsNotNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))

		clear_wiki_content_cache(doc.name)
		self.assertIsNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))

		# Re-render picks up new content after invalidation.
		html, _ = get_rendered_content(doc.name, "v2 fresh")
		self.assertIn("v2 fresh", html)

	def test_content_edit_drops_the_cache_entry(self):
		doc = create_test_wiki_document(self, "Edited Page", content="original text")
		get_rendered_content(doc.name, doc.content)
		self.assertIsNotNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))

		doc.content = "edited text"
		doc.save()
		# on_wiki_document_update fires clear_wiki_content_cache for the changed doc.
		self.assertIsNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))

	def test_non_content_edit_keeps_the_cache_entry(self):
		doc = create_test_wiki_document(self, "Title Only", content="stable body")
		get_rendered_content(doc.name, doc.content)
		self.assertIsNotNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))

		doc.title = "Renamed Title"
		doc.save()
		# Content unchanged, so the rendered-content entry survives.
		self.assertIsNotNone(frappe.cache().hget(WIKI_CONTENT_CACHE_KEY, doc.name))


class TestReaderRouteXSS(unittest.TestCase):
	"""Reader templates interpolate editor-set routes into Alpine JS expressions.
	A route can contain quotes (routes aren't scrubbed once set explicitly), so
	every such interpolation must go through `| tojson | forceescape` — tojson
	makes it a JS-safe string literal, forceescape keeps it safe inside the
	double-quoted HTML attribute. Without both, a route like `x'),alert(1)//`
	breaks out of the JS string and runs for every reader (stored XSS)."""

	# A route crafted to break out of a single-quoted JS string literal.
	PAYLOAD = "s/x'),alert(document.domain)//"

	def _assert_route_is_safe(self, html):
		# The vulnerable pattern is a single-quoted JS literal; after the fix
		# every call passes a double-quoted, entity-encoded literal instead.
		self.assertNotIn("navigateTo('", html)
		self.assertNotIn("inTab('", html)
		self.assertNotIn("notInAnyTab('", html)
		# The route's own single quote is unicode-escaped by tojson, so it can
		# never terminate the JS string — no `'),alert(...)//'` breakout survives.
		self.assertNotIn("//')", html)
		self.assertIn("\\u0027", html)

	def test_sidebar_tree_macro_escapes_route_in_alpine_expressions(self):
		"""render_wiki_tree feeds node.route into navigateTo/prefetch/:class."""
		template = (
			'{% from "templates/wiki/macros/sidebar_tree.html" import render_wiki_tree %}'
			"{{ render_wiki_tree(nodes) }}"
		)
		node = {
			"is_group": 0,
			"is_external_link": 0,
			"name": "n1",
			"route": self.PAYLOAD,
			"title": "Evil",
			"children": [],
		}
		html = frappe.render_template(template, {"nodes": [node]})
		self.assertIn("navigateTo(&#34;", html)  # escaped double-quoted literal used
		self._assert_route_is_safe(html)

	def test_active_js_concat_escapes_route(self):
		"""The tab bar (tabs.html / mobile_header.html) builds the Alpine
		expression by string concatenation before emitting it; the route piece
		must stay escaped through the concat + `{{ }}` render."""
		template = (
			'{% set active_js = "$store.navigation.inTab(" ~ (route | tojson | forceescape) ~ ")" %}'
			'<div x-show="{{ active_js }}"></div>'
		)
		html = frappe.render_template(template, {"route": self.PAYLOAD})
		self.assertIn("inTab(&#34;", html)
		self._assert_route_is_safe(html)

	def test_script_context_uses_bare_tojson_not_forceescape(self):
		"""Inside a <script> block the browser does not HTML-decode, so a value
		interpolated as a JS literal must use bare `tojson` (which escapes
		</script> and quotes to \\uXXXX) — never `tojson | forceescape`, whose
		HTML entities would be a JS syntax error and break Alpine init. Guards
		the `Alpine.store('pageContent', { markdown: ... })` line in
		document.html."""
		hostile = "a \"quote\" and </script><img src=x> and 'x'"
		html = frappe.render_template("markdown: {{ md | tojson }}", {"md": hostile})
		# Valid JS string literal: quotes/script-tag/apostrophes are escaped,
		# and there are no HTML entities that JS would choke on.
		self.assertNotIn("&#34;", html)
		self.assertNotIn("&#39;", html)
		self.assertNotIn("</script>", html)
		self.assertIn("\\u003c/script", html)


# A JPEG magic number is all the endpoint tests need from the renderer; CI
# installs no server-side Chromium, so every test here patches
# get_preview_from_html *at its point of use* in wiki.api.og_image -- patching
# frappe.utils.preview would leave the already-bound import untouched.
FAKE_JPEG = b"\xff\xd8\xff" + b"\x00" * 32


class OGImageTestBase(WikiDocumentTestBase):
	"""Shared setup for the generated-OG-card tests."""

	def setUp(self):
		self.og_doc_keys = []
		self.enterContext(
			self.change_settings("Wiki Settings", {"auto_generate_meta_images": 1}, commit=True)
		)
		self.renderer = self.enterContext(
			patch("wiki.api.og_image.get_preview_from_html", return_value=FAKE_JPEG)
		)
		# Warm-up jobs would otherwise land on the real bench queue and render
		# for real; the warm-up tests assert on this mock instead.
		self.enqueue = self.enterContext(patch("frappe.enqueue"))

	def tearDown(self):
		from wiki.api.og_image import clear_cached_cards

		for doc_key in self.og_doc_keys:
			clear_cached_cards(doc_key)
		super().tearDown()

	def _unique(self, prefix):
		return f"{prefix}-{frappe.generate_hash(length=6)}"

	def _published_page(self, label, guest_readable=True, **kwargs):
		"""A published page in its own space, tracked for card cleanup."""
		route = self._unique(label)
		space = create_test_wiki_space(
			self,
			f"{label} Space",
			route,
			None,
			roles=[("Guest", "Read")] if guest_readable else [],
		)
		doc = create_test_wiki_document(
			self, label, parent=space.root_group, slug=self._unique(label), **kwargs
		)
		doc.reload()
		self.og_doc_keys.append(doc.doc_key)
		return doc

	def _cached_cards(self, doc_key):
		from wiki.api.og_image import _cache_dir

		return sorted(os.path.basename(p) for p in glob.glob(os.path.join(_cache_dir(), f"{doc_key}-*.jpg")))


class TestOGImageEndpoint(OGImageTestBase):
	"""The guest-facing endpoint that renders and serves the card."""

	TEST_CLIENT = get_test_client()

	def _get(self, route, **kwargs):
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		return _make_request(
			self.TEST_CLIENT,
			"get",
			f"/api/method/wiki.api.og_image.og_image?route={quote(route)}",
			**kwargs,
		)

	def test_unknown_route_returns_404(self):
		response = self._get("no-such-space/no-such-page")
		self.assertEqual(response.status_code, 404)

	def test_unpublished_document_returns_404(self):
		doc = self._published_page("og-unpublished")
		doc.is_published = 0
		doc.save()

		self.assertEqual(self._get(doc.route).status_code, 404)

	def test_restricted_space_returns_404_for_guest(self):
		"""A space with no Guest role is invisible to anonymous requests -- 404,
		not 403, so the card endpoint leaks no more than the page itself."""
		doc = self._published_page("og-restricted", guest_readable=False)

		self.assertEqual(self._get(doc.route).status_code, 404)

	def test_toggle_off_returns_404(self):
		"""The kill switch stops Chromium launching, not just the tag being
		emitted -- otherwise crawlers holding an old og:image URL keep paying
		for renders on a site that turned cards off."""
		doc = self._published_page("og-endpoint-off")

		with self.change_settings("Wiki Settings", {"auto_generate_meta_images": 0}, commit=True):
			response = self._get(doc.route)

		self.assertEqual(response.status_code, 404)
		self.renderer.assert_not_called()

	def test_cards_are_never_shared_cacheable(self):
		"""The URL carries no identity, so a `public` Cache-Control would let a
		CDN keep serving a card — title, breadcrumb, space name — after the page
		is unpublished or the space's roles change, without the request ever
		reaching _resolve_doc again. Guest-readable pages included: a page that
		is public today may not be tomorrow."""
		from wiki.api.og_image import og_image

		guest_doc = self._published_page("og-cc-guest")
		restricted_doc = self._published_page("og-cc-restricted", guest_readable=False)

		for cache_control in (
			self._get(guest_doc.route).headers["Cache-Control"],
			og_image(route=restricted_doc.route).headers["Cache-Control"],
		):
			self.assertIn("private", cache_control)
			self.assertNotIn("public", cache_control)

	def test_published_page_returns_jpeg(self):
		doc = self._published_page("og-served")

		response = self._get(doc.route)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.headers["Content-Type"], "image/jpeg")
		self.assertEqual(response.get_data(), FAKE_JPEG)

	def test_repeat_request_serves_the_cached_file(self):
		doc = self._published_page("og-cached")

		self.assertEqual(self._get(doc.route).status_code, 200)
		self.assertEqual(self._get(doc.route).status_code, 200)

		self.assertEqual(self.renderer.call_count, 1)

	def test_if_none_match_returns_304_with_empty_body(self):
		doc = self._published_page("og-etag")
		etag = self._get(doc.route).headers["ETag"]

		response = self._get(doc.route, headers={"If-None-Match": etag})

		self.assertEqual(response.status_code, 304)
		self.assertEqual(response.get_data(), b"")

	def test_rename_moves_the_fingerprint_and_prunes_the_old_card(self):
		doc = self._published_page("og-renamed")
		self._get(doc.route)
		before = self._cached_cards(doc.doc_key)

		doc.title = "Renamed For A New Fingerprint"
		doc.save()
		self._get(doc.route)

		after = self._cached_cards(doc.doc_key)
		self.assertEqual(len(before), 1)
		self.assertEqual(len(after), 1)
		self.assertNotEqual(before, after)


class TestOGImageTemplate(unittest.TestCase):
	"""frappe.render_template does not autoescape, so the card template carries
	its own `| e` on every interpolation. Without it a crafted page title turns
	the screenshotter into an outbound-fetch primitive."""

	def test_hostile_title_is_escaped(self):
		from wiki.api.og_image import render_og_html

		html = render_og_html(
			{
				"title": '"><img src=http://evil.example/x>',
				"title_font_size": 48,
				"breadcrumb_trail": "",
				"space_name": "",
				"logo_url": "",
			}
		)

		self.assertNotIn("<img src=http://evil.example/x>", html)
		self.assertIn("&lt;img", html)

	def test_traversing_doc_key_cannot_escape_the_cache_directory(self):
		"""doc_key names the cache file, and WikiDocument.set_doc_key only makes
		it immutable on update -- an insert keeps whatever the caller passed. A
		key with path separators must never reach open()/unlink()."""
		from wiki.api.og_image import _cache_dir, _cache_path, clear_cached_cards

		for hostile in ("../../evil", "a/b", "..", "with space", ""):
			with self.assertRaises(frappe.DoesNotExistError):
				_cache_path(hostile, "0123456789ab")
			# The delete path must not raise (it runs after commit), just do nothing.
			clear_cached_cards(hostile)

		path = _cache_path("abc123DEF456", "0123456789ab")
		self.assertEqual(os.path.dirname(path), _cache_dir())

	def test_logo_prefers_the_switcher_logo_the_reader_renders(self):
		"""app_switcher_logo is the mark the reader header shows, so the card
		must use it; light_mode_logo is only a fallback for v2 spaces."""
		from wiki.api.og_image import _og_context

		space = SimpleNamespace(app_switcher_logo="/files/new.png", light_mode_logo="/files/old.png")
		doc = SimpleNamespace(
			meta_title=None,
			title="Doc",
			lft=None,
			get_wiki_space=lambda: {"name": "sp", "space_name": "Space"},
		)

		with patch("frappe.get_cached_doc", return_value=space):
			self.assertEqual(_og_context(doc)["logo_url"], "/files/new.png")

		space.app_switcher_logo = None
		with patch("frappe.get_cached_doc", return_value=space):
			self.assertEqual(_og_context(doc)["logo_url"], "/files/old.png")

	def test_card_title_ignores_meta_title(self):
		"""The card shows the page's own title; meta_title is SEO copy for the
		search result, not a label for the page."""
		from wiki.api.og_image import _og_context

		space = SimpleNamespace(app_switcher_logo="", light_mode_logo="")
		doc = SimpleNamespace(
			meta_title="Keyword Padded Meta Title | Docs",
			title="Doc",
			lft=None,
			get_wiki_space=lambda: {"name": "sp", "space_name": "Space"},
		)

		with patch("frappe.get_cached_doc", return_value=space):
			self.assertEqual(_og_context(doc)["title"], "Doc")

	def test_remote_and_private_logo_urls_are_dropped(self):
		from wiki.api.og_image import _safe_asset_url

		self.assertEqual(_safe_asset_url("/files/logo.png"), "/files/logo.png")
		self.assertEqual(_safe_asset_url("/assets/wiki/images/logo.svg"), "/assets/wiki/images/logo.svg")
		self.assertEqual(_safe_asset_url("/private/files/logo.png"), "")
		self.assertEqual(_safe_asset_url("https://evil.example/logo.png"), "")
		self.assertEqual(_safe_asset_url(None), "")


class TestOGImageWarmup(OGImageTestBase):
	"""The background render that runs on document writes, so the first crawler
	after a change is normally a cache hit. Serving never depends on it."""

	def test_structural_save_enqueues_a_warmup(self):
		doc = self._published_page("og-warm-enqueue")
		self.enqueue.reset_mock()

		doc.title = "A Title That Moves The Fingerprint"
		doc.save()

		self.enqueue.assert_called_once()
		self.assertEqual(self.enqueue.call_args.args[0], "wiki.api.og_image.warm_og_image")
		self.assertEqual(self.enqueue.call_args.kwargs["name"], doc.name)
		self.assertTrue(self.enqueue.call_args.kwargs["deduplicate"])
		self.assertTrue(self.enqueue.call_args.kwargs["enqueue_after_commit"])

	def test_content_only_change_enqueues_nothing(self):
		"""Content is not a fingerprint input, so a still-correct card is left
		alone -- this is what keeps a busy wiki from re-rendering on every edit."""
		from wiki.api.og_image import warm_og_image

		doc = self._published_page("og-warm-content")
		warm_og_image(doc.name)
		self.enqueue.reset_mock()

		doc.content = "Completely different body text."
		doc.save()

		self.enqueue.assert_not_called()

	def test_warmup_renders_the_card_without_a_page_view(self):
		from wiki.api.og_image import warm_og_image

		doc = self._published_page("og-warm-render")
		self.assertEqual(self._cached_cards(doc.doc_key), [])

		warm_og_image(doc.name)

		self.assertEqual(len(self._cached_cards(doc.doc_key)), 1)
		self.assertEqual(self.renderer.call_count, 1)

	def test_warmup_skips_when_the_card_is_already_on_disk(self):
		from wiki.api.og_image import warm_og_image

		doc = self._published_page("og-warm-skip")
		warm_og_image(doc.name)
		self.renderer.reset_mock()

		warm_og_image(doc.name)

		self.renderer.assert_not_called()

	def test_toggle_off_enqueues_nothing_and_renders_nothing(self):
		from wiki.api.og_image import warm_og_image

		doc = self._published_page("og-warm-off")

		with self.change_settings("Wiki Settings", {"auto_generate_meta_images": 0}):
			self.enqueue.reset_mock()
			doc.title = "Renamed While Cards Are Disabled"
			doc.save()
			warm_og_image(doc.name)

		self.enqueue.assert_not_called()
		self.renderer.assert_not_called()


class TestOGImageMetaTags(OGImageTestBase):
	"""get_web_context's fallback from meta_image to the generated card."""

	def test_generated_card_is_used_when_no_meta_image(self):
		doc = self._published_page("og-meta-generated")

		metatags = doc.get_web_context()["metatags"]

		self.assertIn("wiki.api.og_image.og_image", metatags["og:image"])
		self.assertEqual(metatags["twitter:card"], "summary_large_image")
		self.assertEqual(metatags["og:image:width"], "1200")
		self.assertEqual(metatags["og:image:height"], "630")
		self.assertEqual(metatags["og:image:type"], "image/jpeg")

	def test_explicit_meta_image_wins_over_the_generated_card(self):
		doc = self._published_page("og-meta-explicit")
		doc.meta_image = "/files/hand-made.png"
		doc.save()

		metatags = doc.get_web_context()["metatags"]

		self.assertEqual(metatags["og:image"], frappe.utils.get_url("/files/hand-made.png"))
		self.assertNotIn("og:image:width", metatags)

	def test_toggle_off_emits_no_image_tags(self):
		doc = self._published_page("og-meta-toggle-off")

		with self.change_settings("Wiki Settings", {"auto_generate_meta_images": 0}):
			metatags = doc.get_web_context()["metatags"]

		self.assertNotIn("og:image", metatags)
		self.assertEqual(metatags["twitter:card"], "summary")

	def test_group_external_link_and_orphan_pages_have_no_card(self):
		space_doc = self._published_page("og-meta-kinds")
		group = create_test_wiki_document(
			self, "OG Group", parent=space_doc.parent_wiki_document, is_group=True
		)
		external = create_test_wiki_document(
			self,
			"OG External",
			parent=space_doc.parent_wiki_document,
			is_external_link=True,
			external_url="https://example.com",
		)
		orphan = create_test_wiki_document(self, "OG Orphan", slug=self._unique("og-orphan"))

		self.assertIsNone(group.get_og_image_url())
		self.assertIsNone(external.get_og_image_url())
		self.assertIsNone(orphan.get_og_image_url())


class TestOGImageTokenDrift(unittest.TestCase):
	"""The card inlines a snapshot of frappe-ui's light-mode tokens rather than
	importing the built stylesheet, so a frappe-ui upgrade can move a value
	silently. Same intent as frappe-ui's own tailwind/audit-token-drift.cjs."""

	# Only the tokens the template actually declares, mapped to their
	# themedVariables.light lookup.
	TOKEN_REFS: typing.ClassVar[dict] = {
		"--ink-gray-9": ("ink", "gray-9"),
		"--ink-gray-7": ("ink", "gray-7"),
		"--ink-gray-5": ("ink", "gray-5"),
		"--outline-gray-2": ("outline", "gray-2"),
		"--surface-gray-2": ("surface", "gray-2"),
		"--surface-base": ("surface", "base"),
	}

	def test_template_tokens_match_frappe_ui(self):
		# Built with os.path.join, not get_app_path's joins: those are scrubbed,
		# which would turn "frappe-ui" into "frappe_ui".
		colors_path = os.path.join(
			frappe.get_app_path("wiki"),
			"..",
			"frontend",
			"node_modules",
			"frappe-ui",
			"tailwind",
			"generated",
			"colors.json",
		)
		if not os.path.exists(colors_path):
			# The Python CI job installs no frontend dependencies.
			raise unittest.SkipTest("frappe-ui is not installed")

		with open(colors_path) as f:
			colors = json.load(f)

		template = frappe.get_app_path("wiki", "templates", "wiki", "og_image.html")
		with open(template) as f:
			declared = dict(re.findall(r"(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6});", f.read()))

		for var, (group, name) in self.TOKEN_REFS.items():
			ref = colors["themedVariables"]["light"][group][name]
			expected = functools.reduce(lambda node, key: node[key], ref.split("/"), colors)
			self.assertEqual(
				declared.get(var),
				expected,
				f"{var} drifted from frappe-ui's {ref}; update the template and bump TEMPLATE_VERSION",
			)
