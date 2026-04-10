# Copyright (c) 2020, Frappe and Contributors
# See license.txt

from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests import FrappeTestCase


class TestWikiPageWebsitePermission(FrappeTestCase):
	def test_private_page_requires_login_when_space_has_no_role_allowlist(self):
		page = frappe.new_doc("Wiki Page")
		page.title = "Private Page"
		page.route = "private/page"
		page.published = 1
		page.allow_guest = 0

		with patch(
			"wiki.wiki.doctype.wiki_page.wiki_page.get_wiki_space_for_route",
			return_value=SimpleNamespace(roles=[]),
		):
			self.assertFalse(page.has_website_permission("read", "Guest"))
			self.assertTrue(page.has_website_permission("read", "user@example.com"))

	def test_space_role_allowlist_blocks_logged_in_user_without_role(self):
		page = frappe.new_doc("Wiki Page")
		page.title = "Restricted Page"
		page.route = "restricted/page"
		page.published = 1
		page.allow_guest = 0

		with (
			patch(
				"wiki.wiki.doctype.wiki_page.wiki_page.get_wiki_space_for_route",
				return_value=SimpleNamespace(roles=[frappe._dict(role="Wiki User")]),
			),
			patch(
				"wiki.wiki.doctype.wiki_page.wiki_page.has_wiki_space_access",
				return_value=False,
			),
		):
			self.assertFalse(page.has_website_permission("read", "user@example.com"))

	def test_published_public_page_allows_guest_when_space_roles_pass(self):
		page = frappe.new_doc("Wiki Page")
		page.title = "Public Page"
		page.route = "public/page"
		page.published = 1
		page.allow_guest = 1

		with patch(
			"wiki.wiki.doctype.wiki_page.wiki_page.get_wiki_space_for_route",
			return_value=None,
		):
			self.assertTrue(page.has_website_permission("read", "Guest"))
