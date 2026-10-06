# Copyright (c) 2026, Frappe and Contributors
# See license.txt

from unittest.mock import patch

import frappe

from wiki.patches.update_desktop_icon_link import execute
from wiki.tests import WikiTestCase as UnitTestCase


class TestUpdateDesktopIconLink(UnitTestCase):
	def test_skips_a_desktop_icon_without_icon_type(self):
		with (
			patch.object(frappe.db, "has_column", return_value=False),
			patch.object(frappe.db, "set_value") as set_value,
		):
			execute()

		set_value.assert_not_called()
