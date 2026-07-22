# Copyright (c) 2020, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestWikiSettings(FrappeTestCase):
	def test_wiki_manager_can_read_and_write(self):
		# The frontend settings dialog is gated on the Wiki Manager role, so that
		# role must hold read+write on the singleton for saves to go through.
		permissions = frappe.get_meta("Wiki Settings").permissions
		read_roles = {p.role for p in permissions if p.read}
		write_roles = {p.role for p in permissions if p.write}
		self.assertIn("Wiki Manager", read_roles)
		self.assertIn("Wiki Manager", write_roles)
