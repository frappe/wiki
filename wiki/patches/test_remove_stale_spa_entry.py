# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import os

import frappe
from frappe.tests import UnitTestCase

from wiki.patches.remove_stale_spa_entry import STALE_ENTRY, execute


class TestRemoveStaleSpaEntry(UnitTestCase):
	def setUp(self):
		self.path = os.path.join(frappe.get_app_path("wiki"), *STALE_ENTRY)

	def tearDown(self):
		# Absent is the state the patch exists to reach, so leave it that way.
		if os.path.exists(self.path):
			os.remove(self.path)

	def test_removes_the_stale_entry(self):
		with open(self.path, "w") as f:
			f.write("<!DOCTYPE html>")

		execute()

		self.assertFalse(os.path.exists(self.path))

	def test_is_a_no_op_when_already_gone(self):
		if os.path.exists(self.path):
			os.remove(self.path)

		execute()

		self.assertFalse(os.path.exists(self.path))
