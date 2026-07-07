# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.core.doctype.user_permission.test_user_permission import create_user
from frappe.tests import IntegrationTestCase
from frappe.tests.utils import FrappeTestCase

from wiki.frappe_wiki.doctype.wiki_change_request.test_wiki_change_request import (
	_approve_and_merge,
	create_test_wiki_document,
	create_test_wiki_space,
)
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	create_change_request,
	create_cr_page,
	delete_cr_page,
	update_cr_page,
)
from wiki.frappe_wiki.doctype.wiki_revision.history import (
	_classify,
	_load_page_timeline,
	diff_page_revisions,
	get_page_history,
)

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestWikiRevision(IntegrationTestCase):
	"""
	Integration tests for WikiRevision.
	Use this class for testing interactions between multiple components.
	"""

	pass


class TestPageHistory(FrappeTestCase):
	"""Read endpoints for a single page's published version history."""

	def tearDown(self):
		frappe.db.rollback()

	def _doc_key(self, name):
		return frappe.get_value("Wiki Document", name, "doc_key")

	def _root_key(self, space):
		return frappe.get_value("Wiki Document", space.root_group, "doc_key")

	# --- Classification --------------------------------------------------------

	def test_classify_change_types(self):
		base = {
			"content_hash": "h1",
			"content_blob": "b1",
			"title": "A",
			"slug": "a",
			"route": "a",
			"parent_key": None,
			"is_published": 1,
			"is_external_link": 0,
			"external_url": None,
		}
		self.assertEqual(_classify(None, base, True), "added")
		self.assertEqual(_classify(base, {**base, "content_hash": "h2"}, True), "edited")
		self.assertEqual(_classify(base, {**base, "title": "B"}, True), "renamed")
		self.assertIsNone(_classify(base, base, True))
		self.assertEqual(_classify(base, None, False), "deleted")
		self.assertIsNone(_classify(None, None, False))

	# --- Timeline reconstruction ----------------------------------------------

	def test_history_lists_only_changing_revisions(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Install", content="v1")
		page_key = self._doc_key(page.name)

		# The first CR bootstraps main_revision — the page's first published
		# snapshot (change_type "added").
		cr1 = create_change_request(space.name, "edit to v2")
		update_cr_page(cr1.name, page_key, {"content": "v2"})
		_approve_and_merge(cr1.name)

		cr2 = create_change_request(space.name, "edit to v3")
		update_cr_page(cr2.name, page_key, {"content": "v3"})
		_approve_and_merge(cr2.name)

		# A merge that never touches this page must not add an entry for it.
		cr3 = create_change_request(space.name, "add sibling")
		create_cr_page(cr3.name, self._root_key(space), "Other", content="x")
		skip_rev = _approve_and_merge(cr3.name)

		history = get_page_history(page.name)
		self.assertEqual([e["change_type"] for e in history], ["edited", "edited", "added"])
		self.assertNotIn(skip_rev, [e["revision"] for e in history])

	def test_identical_content_produces_no_entry(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Doc", content="same")
		page_key = self._doc_key(page.name)

		cr = create_change_request(space.name, "resave same")
		# Re-save byte-identical content: dedups to the same blob, so no real change.
		update_cr_page(cr.name, page_key, {"content": "same"})
		# A sibling gives the CR real changes to merge without touching this page.
		create_cr_page(cr.name, self._root_key(space), "Sibling", content="x")
		_approve_and_merge(cr.name)

		history = get_page_history(page.name)
		self.assertEqual([e["change_type"] for e in history], ["added"])

	def test_deleted_page_shows_in_timeline(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Temp", content="v1")
		page_key = self._doc_key(page.name)

		cr1 = create_change_request(space.name, "edit")
		update_cr_page(cr1.name, page_key, {"content": "v2"})
		_approve_and_merge(cr1.name)

		cr2 = create_change_request(space.name, "delete")
		delete_cr_page(cr2.name, page_key)
		_approve_and_merge(cr2.name)

		# The live document is gone, so query the timeline by (doc_key, space)
		# directly — browsing a deleted page's history via the endpoint is out of
		# scope, but the delete must still register as a change point.
		timeline = _load_page_timeline(page_key, space.name)
		self.assertEqual([e["change_type"] for e in timeline], ["added", "edited", "deleted"])

	def test_concurrent_merge_revision_appears(self):
		"""Guards the "don't walk parent_revision" decision.

		Two CRs branch from the same main M0; merging the second is a three-way
		merge whose revision points parent_revision at M0, skipping the first
		merge M1. Walking parents from the head would miss M1 — the time-ordered
		query must still surface it in the page's history.
		"""
		space = create_test_wiki_space()
		page_a = create_test_wiki_document(space.root_group, title="A", content="a1")
		page_b = create_test_wiki_document(space.root_group, title="B", content="b1")
		a_key = self._doc_key(page_a.name)
		b_key = self._doc_key(page_b.name)

		# Both CRs branch off the same bootstrap main (M0).
		cr_a = create_change_request(space.name, "edit A")
		cr_b = create_change_request(space.name, "edit B")
		m0 = cr_a.base_revision
		self.assertEqual(cr_b.base_revision, m0)

		update_cr_page(cr_a.name, a_key, {"content": "a2"})
		update_cr_page(cr_b.name, b_key, {"content": "b2"})

		m1 = _approve_and_merge(cr_a.name)  # fast-forward: main -> M1
		m2 = _approve_and_merge(cr_b.name)  # three-way: parent_revision = M0

		# The quirk exists: M2 skips M1 in the parent chain.
		self.assertEqual(frappe.db.get_value("Wiki Revision", m2, "parent_revision"), m0)

		a_revs = [e["revision"] for e in get_page_history(page_a.name)]
		self.assertIn(m1, a_revs)  # a parent-walk from the head would miss this

		b_revs = [e["revision"] for e in get_page_history(page_b.name)]
		self.assertIn(m2, b_revs)

	# --- Diff ------------------------------------------------------------------

	def test_diff_page_revisions(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Doc", content="v1")
		page_key = self._doc_key(page.name)

		cr1 = create_change_request(space.name, "v2")
		update_cr_page(cr1.name, page_key, {"content": "v2"})
		m1 = _approve_and_merge(cr1.name)

		cr2 = create_change_request(space.name, "v3")
		update_cr_page(cr2.name, page_key, {"content": "v3"})
		m2 = _approve_and_merge(cr2.name)

		history = get_page_history(page.name)
		self.assertEqual(len(history), 3)  # added + two edits
		bootstrap_rev = history[-1]["revision"]

		# Explicit base revision.
		diff = diff_page_revisions(page.name, m2, base_revision=m1)
		self.assertEqual(diff["base"]["content"], "v2")
		self.assertEqual(diff["head"]["content"], "v3")

		# Omitted base → predecessor derived from the history walk.
		diff2 = diff_page_revisions(page.name, m1)
		self.assertEqual(diff2["base"]["content"], "v1")
		self.assertEqual(diff2["head"]["content"], "v2")

		# The added revision has no predecessor → empty base.
		diff3 = diff_page_revisions(page.name, bootstrap_rev)
		self.assertIsNone(diff3["base"])
		self.assertEqual(diff3["head"]["content"], "v1")

	# --- Permission ------------------------------------------------------------

	def test_history_requires_contribute_permission(self):
		space = create_test_wiki_space()
		page = create_test_wiki_document(space.root_group, title="Doc", content="v1")
		page_key = self._doc_key(page.name)
		cr = create_change_request(space.name, "v2")
		update_cr_page(cr.name, page_key, {"content": "v2"})
		m1 = _approve_and_merge(cr.name)

		# Read-only user on a space that no longer accepts contributions.
		frappe.db.set_value("Wiki Space", space.name, "allow_contributions", 0)
		reader = create_user("history-reader@example.com", "Wiki User")
		frappe.set_user(reader.name)
		try:
			with self.assertRaises(frappe.PermissionError):
				get_page_history(page.name)
			with self.assertRaises(frappe.PermissionError):
				diff_page_revisions(page.name, m1)
		finally:
			frappe.set_user("Administrator")

		# A manager (Administrator) can always view.
		self.assertTrue(get_page_history(page.name))
