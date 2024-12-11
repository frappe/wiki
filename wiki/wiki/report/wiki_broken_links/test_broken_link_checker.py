# Copyright (c) 2024, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki.report.wiki_broken_links.wiki_broken_links import execute, get_broken_links

BROKEN_LINK = "https://frappewiki.notavalidtld"
BROKEN_IMG_LINK = "https://img.notavalidtld/failed.jpeg"

TEST_MD_WITH_BROKEN_LINK = f"""
## Hello

This is a test for a [broken link]({BROKEN_LINK}).

This is a [valid link](https://frappe.io).

![Broken Image]({BROKEN_IMG_LINK})
"""


class TestWikiBrokenLinkChecker(FrappeTestCase):
	def setUp(self):
		frappe.db.delete("Wiki Page")
		self.test_wiki_page = frappe.get_doc(
			{
				"doctype": "Wiki Page",
				"content": TEST_MD_WITH_BROKEN_LINK,
				"title": "My Wiki Page",
				"route": "test-wiki-page-route",
			}
		).insert()

		self.test_wiki_space = frappe.get_doc({"doctype": "Wiki Space", "route": "test-ws-route"}).insert()

	def test_returns_correct_broken_links(self):
		broken_links = get_broken_links(TEST_MD_WITH_BROKEN_LINK)
		self.assertEqual(len(broken_links), 2)

	def test_wiki_broken_link_report(self):
		_, data = execute()
		self.assertEqual(len(data), 1)
		self.assertEqual(data[0]["broken_link"], BROKEN_LINK)

	def test_wiki_broken_link_report_with_wiki_space_filter(self):
		_, data = execute({"wiki_space": self.test_wiki_space.name})
		self.assertEqual(len(data), 0)

		self.test_wiki_space.append(
			"wiki_sidebars", {"wiki_page": self.test_wiki_page, "parent_label": "Test Parent Label"}
		)
		self.test_wiki_space.save()

		_, data = execute({"wiki_space": self.test_wiki_space.name})
		self.assertEqual(len(data), 1)
		self.assertEqual(data[0]["wiki_page"], self.test_wiki_page.name)
		self.assertEqual(data[0]["broken_link"], BROKEN_LINK)

	def test_wiki_broken_link_report_with_image_filter(self):
		_, data = execute({"check_images": 1})
		self.assertEqual(len(data), 2)
		self.assertEqual(data[0]["wiki_page"], self.test_wiki_page.name)
		self.assertEqual(data[0]["broken_link"], BROKEN_LINK)

		self.assertEqual(data[1]["wiki_page"], self.test_wiki_page.name)
		self.assertEqual(data[1]["broken_link"], BROKEN_IMG_LINK)

	def tearDown(self):
		frappe.db.rollback()
