# Copyright (c) 2026, Frappe and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from wiki import telemetry
from wiki.www import wiki_app


class TestTelemetry(IntegrationTestCase):
	def test_every_event_carries_the_shared_properties(self):
		with patch.object(telemetry.frappe_telemetry, "capture") as capture:
			telemetry.capture("space_created", visibility="public")

		capture.assert_called_once()
		properties = capture.call_args.kwargs["properties"]
		self.assertEqual(capture.call_args.args, ("space_created", "wiki"))
		self.assertEqual(properties["visibility"], "public")
		self.assertEqual(properties["app_version"], frappe.get_attr("wiki.__version__"))
		self.assertIn(properties["entry"], ("saas_trial", "self_hosted"))

	def test_a_failing_send_does_not_fail_the_action(self):
		with patch.object(telemetry.frappe_telemetry, "capture", side_effect=Exception("pulse down")):
			telemetry.capture("space_created")

	def test_the_app_shell_reports_an_active_site_once_a_day(self):
		with patch.object(wiki_app, "capture") as capture:
			wiki_app.get_context()

		capture.assert_called_once_with("active_site", interval="1d")

	def test_a_guest_is_not_an_active_site(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("Guest")

		with patch.object(wiki_app, "capture") as capture:
			wiki_app.get_context()

		capture.assert_not_called()

	def test_the_boot_payload_carries_the_shared_properties(self):
		self.assertEqual(wiki_app.get_boot()["telemetry"], telemetry.default_properties())
