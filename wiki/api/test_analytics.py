# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from wiki import analytics_store as store
from wiki.api import analytics
from wiki.api.analytics import get_view_tracking, set_view_tracking
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


def get_analytics(*args, **kwargs):
	# Rebuilt rather than ingested: these rows are backdated, so they sit behind the
	# high-water mark an incremental ingest starts from. Once per call, not per logged view.
	store.rebuild()
	return analytics.get_analytics(*args, **kwargs)


def get_overview(*args, **kwargs):
	store.rebuild()
	return analytics.get_overview(*args, **kwargs)


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
		self.tracking_before = frappe.db.get_single_value("Website Settings", "enable_view_tracking")

	def tearDown(self):
		frappe.set_user("Administrator")
		# tearDown commits, so a test that flips tracking must not leave it flipped.
		frappe.db.set_single_value("Website Settings", "enable_view_tracking", self.tracking_before)
		self.fixtures.destroy_all()
		frappe.db.delete("Web Page View", {"path": ("like", "analytics%")})
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		store.rebuild()

	def test_counts_the_space_route_and_its_pages_only(self):
		_log_view(self.route, "2026-03-10 09:00:00")
		_log_view(f"{self.route}/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route}/guides/setup", "2026-03-11 10:00:00")
		# A sibling route sharing the prefix, and one the `_` wildcard would match.
		_log_view(f"{self.route}x/intro", "2026-03-10 10:00:00")
		_log_view(f"{self.route.replace('_', 'X')}/intro", "2026-03-10 10:00:00")

		result = get_analytics(**self.march)

		self.assertEqual(result["total_views"], 3)

	def test_space_scope_leaves_out_nested_spaces(self):
		# The writer role has no access here, so its traffic is not theirs to see.
		nested = self.fixtures.space(route=f"{self.route}/v2", roles=[("System Manager", "Write")])
		_log_view(f"{self.route}/a", "2026-03-10 09:00:00")
		_log_view(f"{self.route}/v2/b", "2026-03-10 09:00:00")
		frappe.set_user(self.writer)

		result = get_analytics(**self.march)

		self.assertEqual(result["total_views"], 1)
		self.assertEqual([row["path"] for row in result["top_pages"]], [f"{self.route}/a"])
		frappe.set_user("Administrator")
		self.assertEqual(get_analytics("2026-03-01", "2026-03-31", space=nested.name)["total_views"], 1)

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
				{"path": f"{self.route}/gone", "document": None, "title": None, "views": 3},
				{"path": page.route, "document": page.name, "title": "Analytics Intro", "views": 2},
				{"path": self.route, "document": None, "title": self.space.space_name, "views": 1},
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

	def test_reports_whether_tracking_is_on_without_caching_it(self):
		frappe.db.set_single_value("Website Settings", "enable_view_tracking", 0)
		self.assertFalse(get_analytics(**self.march)["tracking_enabled"])

		set_view_tracking()

		self.assertTrue(get_analytics(**self.march)["tracking_enabled"])

	def test_tracking_switches_both_ways(self):
		set_view_tracking(True)
		self.assertTrue(get_view_tracking())

		# A POST sends the flag as a string; the type hint is what turns it back.
		set_view_tracking("false")

		self.assertFalse(get_view_tracking())
		self.assertFalse(frappe.get_website_settings("enable_view_tracking"))

	def test_only_managers_can_turn_tracking_on(self):
		frappe.db.set_single_value("Website Settings", "enable_view_tracking", 0)
		frappe.set_user(self.writer)

		with self.assertRaises(frappe.PermissionError):
			set_view_tracking()

		frappe.set_user("Administrator")
		self.assertFalse(frappe.get_website_settings("enable_view_tracking"))

	def test_rejects_space_and_document_together(self):
		page = self.fixtures.document(parent=self.space.root_group, title="Analytics Both")
		with self.assertRaises(frappe.ValidationError):
			get_analytics("2026-03-01", "2026-03-31", space=self.space.name, document=page.name)


class TestGetOverview(IntegrationTestCase):
	def setUp(self):
		self.fixtures = WikiFixtures()
		self.route = unique_route("analytics_overview")
		self.space = self.fixtures.space(route=self.route)
		# Nested inside the first space's route, so its pages must not count towards that space.
		self.nested = self.fixtures.space(route=f"{self.route}/v2")
		# A week far from any other test's rows, since the numbers are wiki-wide.
		self.week = {"from_date": "2031-03-08", "to_date": "2031-03-14"}

	def tearDown(self):
		frappe.set_user("Administrator")
		self.fixtures.destroy_all()
		frappe.db.delete("Web Page View", {"path": ("like", "analytics%")})
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		store.rebuild()

	def test_compares_each_number_against_the_previous_window(self):
		for hour in (9, 10):
			_log_view(f"{self.route}/a", f"2031-03-03 {hour}:00:00", visitor_id=f"old-{hour}")
		for hour in (9, 10, 11):
			_log_view(f"{self.route}/a", f"2031-03-10 {hour}:00:00", visitor_id=f"new-{hour}")
		_log_view(f"{self.route}/v2/b", "2031-03-11 09:00:00")
		_log_view("analytics-not-a-wiki-page", "2031-03-11 09:00:00")

		overview = get_overview(**self.week)

		self.assertEqual(overview["views"], {"value": 4, "delta": 100.0})
		self.assertEqual(overview["new_visitors"], {"value": 3, "delta": 50.0})
		spaces = {row["name"]: (row["views"], row["delta"]) for row in overview["spaces"]}
		self.assertEqual(spaces[self.space.name], (3, 50.0))
		# Nothing before is no delta, not +100%.
		self.assertEqual(spaces[self.nested.name], (1, None))
		self.assertEqual(
			[(row["path"], row["space"], row["views"]) for row in overview["top_pages"]],
			[(f"{self.route}/a", self.space.name, 3), (f"{self.route}/v2/b", self.nested.name, 1)],
		)

	def test_ranks_referrers_against_the_previous_window(self):
		own = frappe.utils.get_url()
		_log_view(f"{self.route}/a", "2031-03-03 09:00:00", referrer="https://www.google.com/")
		_log_view(f"{self.route}/a", "2031-03-03 10:00:00", referrer="https://www.google.com/")
		for hour in (9, 10, 11):
			_log_view(f"{self.route}/a", f"2031-03-10 {hour}:00:00", referrer="https://www.google.com/?q=a")
		_log_view(f"{self.route}/v2/b", "2031-03-11 09:00:00", referrer="https://github.com/frappe/wiki")
		_log_view(f"{self.route}/a", "2031-03-12 09:00:00", referrer="")
		_log_view(f"{self.route}/a", "2031-03-12 10:00:00", referrer=f"{own}/{self.route}/v2/b")
		_log_view("analytics-not-a-wiki-page", "2031-03-12 09:00:00", referrer="https://github.com/")

		overview = get_overview(**self.week)

		self.assertEqual(
			overview["top_referrers"],
			[
				{"referrer": "www.google.com", "views": 3, "delta": 50.0},
				{"referrer": None, "views": 1, "delta": None},
				{"referrer": "github.com", "views": 1, "delta": None},
			],
		)

	def test_counts_open_change_requests_by_space(self):
		for space, status in (
			(self.space, "In Review"),
			(self.space, "Changes Requested"),
			(self.space, "Approved"),
			(self.space, "Draft"),
			(self.space, "Merged"),
			(self.space, "Rejected"),
			(self.space, "Archived"),
			(self.nested, "In Review"),
		):
			cr = frappe.get_doc(
				{
					"doctype": "Wiki Change Request",
					"title": status,
					"wiki_space": space.name,
					"status": status,
				}
			)
			cr.db_insert()
			self.fixtures.track("Wiki Change Request", cr)

		overview = get_overview(**self.week)
		# The site has change requests of its own, so only these spaces are compared.
		rows = [
			row
			for row in overview["open_change_requests_by_space"]
			if row["space"] in (self.space.name, self.nested.name)
		]

		self.assertEqual(
			rows,
			[
				{"space": self.space.name, "space_name": self.space.space_name, "count": 3},
				{"space": self.nested.name, "space_name": self.nested.space_name, "count": 1},
			],
		)
		self.assertEqual(
			overview["open_change_requests"]["value"],
			sum(row["count"] for row in overview["open_change_requests_by_space"]),
		)

	def test_is_for_managers_only(self):
		frappe.set_user(_ensure_user("analytics_writer@example.com", WRITER_ROLE))
		with self.assertRaises(frappe.PermissionError):
			get_overview(**self.week)
