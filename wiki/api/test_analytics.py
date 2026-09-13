# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from wiki.api.analytics import get_analytics
from wiki.tests.factory import WikiFixtures, unique_route

READER_ROLE = "_Test Analytics Reader"
WRITER_ROLE = "_Test Analytics Writer"


def _ensure_user(email: str, role: str) -> str:
	if not frappe.db.exists("Role", role):
		frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 0}).insert()
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{"doctype": "User", "email": email, "first_name": "Analytics", "send_welcome_email": 0}
		).insert()
	frappe.get_doc("User", email).add_roles("Wiki User", role)
	return email


def _log_view(path: str, creation: str) -> None:
	view = frappe.get_doc({"doctype": "Web Page View", "path": path}).insert(ignore_permissions=True)
	frappe.db.set_value("Web Page View", view.name, "creation", creation, update_modified=False)


class TestGetAnalytics(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.reader = _ensure_user("analytics_reader@example.com", READER_ROLE)
		cls.writer = _ensure_user("analytics_writer@example.com", WRITER_ROLE)

	def setUp(self):
		self.fixtures = WikiFixtures()
		# `_` is a LIKE wildcard, so the route carries one on purpose.
		self.route = unique_route("analytics_docs")
		self.space = self.fixtures.space(
			route=self.route, roles=[(READER_ROLE, "Read"), (WRITER_ROLE, "Write")]
		)

	def tearDown(self):
		frappe.set_user("Administrator")
		self.fixtures.destroy_all()
		frappe.db.delete("Web Page View", {"path": ("like", "analytics%")})
		frappe.db.commit()  # nosemgrep: destroy_all already committed the fixtures' teardown

	def test_counts_the_space_route_and_its_pages_only(self):
		_log_view(self.route, "2026-03-10 09:00:00")
		_log_view(f"{self.route}/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route}/guides/setup", "2026-03-11 10:00:00")
		# A sibling route sharing the prefix, and one the `_` wildcard would match.
		_log_view(f"{self.route}x/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route.replace('_', 'X')}/intro", "2026-03-10 10:00:00")

		result = get_analytics(self.space.name, "2026-03-01", "2026-03-31")

		self.assertEqual(result, {"total_views": 3})

	def test_date_range_is_inclusive_of_both_days(self):
		_log_view(f"{self.route}/a", "2026-02-28 23:59:59")
		_log_view(f"{self.route}/b", "2026-03-01 00:00:00")
		_log_view(f"{self.route}/c", "2026-03-31 23:59:59")
		_log_view(f"{self.route}/d", "2026-04-01 00:00:00")

		result = get_analytics(self.space.name, "2026-03-01", "2026-03-31")

		self.assertEqual(result["total_views"], 2)

	def test_space_writer_can_read_analytics(self):
		frappe.set_user(self.writer)
		self.assertEqual(get_analytics(self.space.name, "2026-03-01", "2026-03-31"), {"total_views": 0})

	def test_space_reader_cannot_read_analytics(self):
		frappe.set_user(self.reader)
		with self.assertRaises(frappe.PermissionError):
			get_analytics(self.space.name, "2026-03-01", "2026-03-31")

	def test_rejects_inverted_and_oversized_ranges(self):
		with self.assertRaises(frappe.ValidationError):
			get_analytics(self.space.name, "2026-03-31", "2026-03-01")
		with self.assertRaises(frappe.ValidationError):
			get_analytics(self.space.name, "2024-01-01", "2026-03-01")
