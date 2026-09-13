# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from wiki.api.analytics import get_analytics
from wiki.frappe_wiki.doctype.wiki_page_view_daily.wiki_page_view_daily import roll_up_day
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


def _log_view(path: str, creation: str, visitor_id: str | None = None, referrer: str | None = None) -> None:
	view = frappe.get_doc(
		{"doctype": "Web Page View", "path": path, "visitor_id": visitor_id, "referrer": referrer}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Web Page View", view.name, "creation", creation, update_modified=False)
	roll_up_day(frappe.utils.getdate(creation))


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
		self.march = {"from_date": "2026-03-01", "to_date": "2026-03-31", "space": self.space.name}

	def tearDown(self):
		frappe.set_user("Administrator")
		self.fixtures.destroy_all()
		frappe.db.delete("Web Page View", {"path": ("like", "analytics%")})
		frappe.db.delete("Wiki Page View Daily", {"path": ("like", "analytics%")})
		frappe.db.commit()  # nosemgrep: destroy_all already committed the fixtures' teardown

	def test_counts_the_space_route_and_its_pages_only(self):
		_log_view(self.route, "2026-03-10 09:00:00")
		_log_view(f"{self.route}/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route}/guides/setup", "2026-03-11 10:00:00")
		# A sibling route sharing the prefix, and one the `_` wildcard would match.
		_log_view(f"{self.route}x/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route.replace('_', 'X')}/intro", "2026-03-10 10:00:00")

		result = get_analytics(**self.march)

		self.assertEqual(result["total_views"], 3)

	def test_date_range_is_inclusive_of_both_days(self):
		_log_view(f"{self.route}/a", "2026-02-28 23:59:59")
		_log_view(f"{self.route}/b", "2026-03-01 00:00:00")
		_log_view(f"{self.route}/c", "2026-03-31 23:59:59")
		_log_view(f"{self.route}/d", "2026-04-01 00:00:00")

		result = get_analytics(**self.march)

		self.assertEqual(result["total_views"], 2)

	def test_space_writer_can_read_analytics(self):
		frappe.set_user(self.writer)
		self.assertEqual(get_analytics(**self.march)["total_views"], 0)

	def test_space_reader_cannot_read_analytics(self):
		frappe.set_user(self.reader)
		with self.assertRaises(frappe.PermissionError):
			get_analytics(**self.march)

	def test_rejects_inverted_and_oversized_ranges(self):
		with self.assertRaises(frappe.ValidationError):
			get_analytics("2026-03-31", "2026-03-01", space=self.space.name)
		with self.assertRaises(frappe.ValidationError):
			get_analytics("2024-01-01", "2026-03-01", space=self.space.name)

		with self.assertRaises(frappe.ValidationError):
			get_analytics("2026-03-01", "2026-03-02", interval="hourly", space=self.space.name)

	def test_new_visitors_count_first_views_in_scope(self):
		_log_view(f"{self.route}/a", "2026-03-10 09:00:00", visitor_id="v1")
		_log_view(f"{self.route}/b", "2026-03-10 09:05:00", visitor_id="v1")
		_log_view(f"{self.route}/a", "2026-03-11 09:00:00", visitor_id="v2")
		_log_view(f"{self.route}/a", "2026-03-11 10:00:00")

		result = get_analytics(**self.march)

		self.assertEqual((result["total_views"], result["new_visitors"]), (4, 2))

	def test_daily_series_fills_empty_days(self):
		_log_view(f"{self.route}/a", "2026-03-02 09:00:00", visitor_id="v1")
		_log_view(f"{self.route}/a", "2026-03-02 23:00:00", visitor_id="v1")
		_log_view(f"{self.route}/a", "2026-03-04 00:00:00", visitor_id="v2")

		series = get_analytics("2026-03-01", "2026-03-04", space=self.space.name)["series"]

		self.assertEqual(
			[(str(point["date"]), point["views"], point["new_visitors"]) for point in series],
			[
				("2026-03-01", 0, 0),
				("2026-03-02", 2, 1),
				("2026-03-03", 0, 0),
				("2026-03-04", 1, 1),
			],
		)

	def test_weekly_and_monthly_buckets(self):
		_log_view(f"{self.route}/a", "2026-03-03 09:10:00")  # Tuesday
		_log_view(f"{self.route}/a", "2026-03-03 09:50:00")
		_log_view(f"{self.route}/a", "2026-03-09 00:00:00")  # next Monday
		_log_view(f"{self.route}/a", "2026-04-01 00:00:00")

		def buckets(from_date, to_date, interval):
			series = get_analytics(from_date, to_date, interval=interval, space=self.space.name)["series"]
			return {str(point["date"]): point["views"] for point in series if point["views"]}

		self.assertEqual(
			buckets("2026-03-01", "2026-03-10", "weekly"),
			{"2026-03-02": 2, "2026-03-09": 1},
		)
		self.assertEqual(
			buckets("2026-03-01", "2026-04-30", "monthly"),
			{"2026-03-01": 3, "2026-04-01": 1},
		)

	def test_top_pages_carry_titles_and_rank_by_views(self):
		page = self.fixtures.document(parent=self.space.root_group, title="Analytics Intro")
		_log_view(page.route, "2026-03-10 09:00:00")
		_log_view(page.route, "2026-03-10 10:00:00")
		_log_view(self.route, "2026-03-10 11:00:00")
		_log_view(f"{self.route}/gone", "2026-03-10 12:00:00")
		_log_view(f"{self.route}/gone", "2026-03-10 12:30:00")
		_log_view(f"{self.route}/gone", "2026-03-10 13:00:00")

		top_pages = get_analytics(**self.march)["top_pages"]

		self.assertEqual(
			top_pages,
			[
				{"path": f"{self.route}/gone", "title": None, "views": 3},
				{"path": page.route, "title": "Analytics Intro", "views": 2},
				{"path": self.route, "title": self.space.space_name, "views": 1},
			],
		)

	def test_top_referrers_group_by_host_and_skip_own_site(self):
		own = frappe.utils.get_url()
		_log_view(f"{self.route}/a", "2026-03-10 09:00:00", referrer="https://www.google.com/search?q=a")
		_log_view(f"{self.route}/a", "2026-03-10 09:01:00", referrer="https://www.google.com/")
		_log_view(f"{self.route}/a", "2026-03-10 09:02:00", referrer="https://www.google.com/?q=b")
		_log_view(f"{self.route}/a", "2026-03-10 09:02:00", referrer="https://github.com/frappe/wiki")
		_log_view(f"{self.route}/b", "2026-03-10 09:02:00", referrer="https://github.com/frappe/wiki/pulls")
		_log_view(f"{self.route}/a", "2026-03-10 09:03:00", referrer="")
		_log_view(f"{self.route}/b", "2026-03-10 09:04:00", referrer=f"{own}/{self.route}/a")

		top_referrers = get_analytics(**self.march)["top_referrers"]

		self.assertEqual(
			top_referrers,
			[
				{"referrer": "www.google.com", "views": 3},
				{"referrer": "github.com", "views": 2},
				{"referrer": None, "views": 1},
			],
		)

	def test_page_scope_counts_exact_path_and_skips_top_pages(self):
		page = self.fixtures.document(parent=self.space.root_group, title="Analytics Exact")
		_log_view(page.route, "2026-03-10 09:00:00")
		_log_view(f"{page.route}/child", "2026-03-10 09:00:00")
		frappe.set_user(self.writer)

		result = get_analytics("2026-03-01", "2026-03-31", document=page.name)

		self.assertEqual(result["total_views"], 1)
		self.assertNotIn("top_pages", result)

	def test_page_scope_denies_space_reader(self):
		page = self.fixtures.document(parent=self.space.root_group, title="Analytics Hidden")
		frappe.set_user(self.reader)
		with self.assertRaises(frappe.PermissionError):
			get_analytics("2026-03-01", "2026-03-31", document=page.name)

	def test_wiki_wide_scope_is_for_managers_only(self):
		_log_view(f"{self.route}/a", "2026-03-10 09:00:00")
		_log_view("analytics-not-a-wiki-page", "2026-03-10 09:00:00")

		result = get_analytics("2026-03-01", "2026-03-31")
		paths = {row["path"] for row in result["top_pages"]}
		self.assertIn(f"{self.route}/a", paths)
		self.assertNotIn("analytics-not-a-wiki-page", paths)

		frappe.set_user(self.writer)
		with self.assertRaises(frappe.PermissionError):
			get_analytics("2026-03-01", "2026-03-31")

	def test_rejects_space_and_document_together(self):
		page = self.fixtures.document(parent=self.space.root_group, title="Analytics Both")
		with self.assertRaises(frappe.ValidationError):
			get_analytics("2026-03-01", "2026-03-31", space=self.space.name, document=page.name)
