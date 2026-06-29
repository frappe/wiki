# Copyright (c) 2024, Frappe and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki.report.wiki_broken_links.wiki_broken_links import execute, get_broken_links

# RFC 2606 reserved domain: always resolves, never flakes in CI (unlike a real
# site, which can intermittently be unreachable and get mis-flagged as broken).
WORKING_EXTERNAL_URL = "https://example.com"
BROKEN_EXTERNAL_URL = "https://frappewiki.notavalidtld"
BROKEN_IMG_URL = "https://img.notavalidtld/failed.jpeg"
WORKING_INTERNAL_URL = "/api/method/ping"
BROKEN_INTERNAL_URL = "/api/method/ring"


def internal_to_external_urls(internal_url: str) -> str:
	if internal_url == WORKING_INTERNAL_URL:
		return WORKING_EXTERNAL_URL
	else:
		return BROKEN_EXTERNAL_URL


TEST_MD_WITH_BROKEN_LINK = f"""
## Hello

This is a test for a [broken link]({BROKEN_EXTERNAL_URL}).

This is a [valid link]({WORKING_EXTERNAL_URL}).
And [this is a correct relative link]({WORKING_INTERNAL_URL}).
And [this is an incorrect relative link]({BROKEN_INTERNAL_URL}).

This [hash link](#hash-link) should be ignored.

![Broken Image]({BROKEN_IMG_URL})
"""


class TestWikiBrokenLinkChecker(FrappeTestCase):
	def setUp(self):
		# Create a root group for the wiki space
		self.root_group = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Test Root Group",
				"is_group": 1,
			}
		).insert()

		# Create a test wiki document with broken links
		self.test_wiki_document = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"content": TEST_MD_WITH_BROKEN_LINK,
				"title": "My Wiki Document",
				"parent_wiki_document": self.root_group.name,
			}
		).insert()

		# Create a wiki space with the root group
		self.test_wiki_space = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"route": f"test-ws-route-{frappe.generate_hash(length=6)}",
				"root_group": self.root_group.name,
			}
		).insert()

	def test_returns_correct_broken_links(self):
		broken_links = get_broken_links(TEST_MD_WITH_BROKEN_LINK)
		self.assertEqual(len(broken_links), 2)

	def test_wiki_broken_link_report(self):
		_, data = execute()
		# Filter to only our test document to avoid interference from other documents
		test_data = [d for d in data if d["wiki_document"] == self.test_wiki_document.name]
		self.assertEqual(len(test_data), 1)
		self.assertEqual(test_data[0]["broken_link"], BROKEN_EXTERNAL_URL)

	def test_wiki_broken_link_report_with_wiki_space_filter(self):
		# Create a new space without our document
		empty_root = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Empty Root",
				"is_group": 1,
			}
		).insert()

		empty_space = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"route": f"empty-space-{frappe.generate_hash(length=6)}",
				"root_group": empty_root.name,
			}
		).insert()

		# Empty space should have no broken links
		_, data = execute({"wiki_space": empty_space.name})
		self.assertEqual(len(data), 0)

		# Our test space should have the broken link
		_, data = execute({"wiki_space": self.test_wiki_space.name})
		self.assertEqual(len(data), 1)
		self.assertEqual(data[0]["wiki_document"], self.test_wiki_document.name)
		self.assertEqual(data[0]["broken_link"], BROKEN_EXTERNAL_URL)

	def test_wiki_broken_link_report_with_image_filter(self):
		_, data = execute({"check_images": 1})
		# Filter to only our test document
		test_data = [d for d in data if d["wiki_document"] == self.test_wiki_document.name]
		self.assertEqual(len(test_data), 2)
		broken_links = [d["broken_link"] for d in test_data]
		self.assertIn(BROKEN_EXTERNAL_URL, broken_links)
		self.assertIn(BROKEN_IMG_URL, broken_links)

	@patch.object(frappe.utils.data, "get_url", side_effect=internal_to_external_urls)
	def test_wiki_broken_link_report_with_internal_links(self, _get_url):
		# patch the get_url to return valid/invalid external links instead
		# of internal links in test
		_, data = execute({"check_internal_links": 1})
		# Filter to only our test document
		test_data = [d for d in data if d["wiki_document"] == self.test_wiki_document.name]

		self.assertEqual(len(test_data), 2)
		broken_links = [d["broken_link"] for d in test_data]
		self.assertIn(BROKEN_EXTERNAL_URL, broken_links)
		self.assertIn(BROKEN_INTERNAL_URL, broken_links)

	def tearDown(self):
		frappe.db.rollback()
