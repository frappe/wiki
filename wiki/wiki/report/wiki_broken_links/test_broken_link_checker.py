# Copyright (c) 2024, Frappe and Contributors
# See license.txt

from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki.report.wiki_broken_links import wiki_broken_links
from wiki.wiki.report.wiki_broken_links.wiki_broken_links import (
	BROWSER_USER_AGENT,
	execute,
	get_broken_links,
	is_broken_link,
	is_dead_status,
)

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


class TestBrokenLinkStatusClassification(FrappeTestCase):
	"""Regression tests for issue #575: valid third-party links flagged as broken.

	Sites behind bot protection / auth walls answer with 401/403/405/429 to a bare
	python-requests call. Only 404 and 5xx responses reliably mean a link is dead.
	"""

	def test_only_404_and_5xx_are_dead(self):
		for code in (404, 500, 502, 503, 599):
			self.assertTrue(is_dead_status(code), f"{code} should be dead")

	def test_bot_protection_and_ok_codes_are_not_dead(self):
		# 403/405/429 are the exact false positives from the issue screenshots.
		for code in (200, 301, 401, 403, 405, 429):
			self.assertFalse(is_dead_status(code), f"{code} should not be dead")

	def test_403_is_not_broken(self):
		with patch.object(wiki_broken_links, "get_request_status_code", return_value=403):
			self.assertFalse(is_broken_link("https://en.wikipedia.org/wiki/Incoterms"))

	def test_404_is_broken(self):
		with patch.object(wiki_broken_links, "get_request_status_code", return_value=404):
			self.assertTrue(is_broken_link("https://erp.fairkom.net/cloud/fairlogin-client"))

	def test_unreachable_host_is_broken(self):
		# An exception means the host can't be reached at all (DNS failure,
		# refused/reset connection, timeout) — a genuinely broken link.
		with patch.object(wiki_broken_links, "get_request_status_code", side_effect=Exception("boom")):
			self.assertTrue(is_broken_link("https://frappewiki.notavalidtld"))

	def test_request_sends_browser_user_agent(self):
		# The default python-requests UA is what got these links blocked.
		response = MagicMock(status_code=200)
		with patch.object(wiki_broken_links.requests, "head", return_value=response) as mock_head:
			wiki_broken_links.get_request_status_code("https://en.wikipedia.org/wiki/Incoterms")
		self.assertEqual(mock_head.call_args.kwargs["headers"]["User-Agent"], BROWSER_USER_AGENT)
