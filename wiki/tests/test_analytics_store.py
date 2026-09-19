# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate

from wiki import analytics_store as store

MARCH = (getdate("2026-03-01"), getdate("2026-03-31"))
MARCH_2031 = (getdate("2031-03-01"), getdate("2031-03-31"))


def _log(path: str, creation: str, visitor_id: str | None = None, referrer: str | None = None) -> str:
	view = frappe.get_doc(
		{"doctype": "Web Page View", "path": path, "visitor_id": visitor_id, "referrer": referrer}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Web Page View", view.name, "creation", creation, update_modified=False)
	return view.name


class TestAnalyticsStore(IntegrationTestCase):
	def setUp(self):
		frappe.db.delete("Web Page View", {"path": ("like", "store%")})
		store.rebuild()

	def tearDown(self):
		frappe.db.delete("Web Page View", {"path": ("like", "store%")})
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		store.rebuild()

	def test_counts_a_visitors_first_view_only_once(self):
		_log("store/a", "2026-03-10 09:00:00", visitor_id="v1")
		_log("store/b", "2026-03-10 09:05:00", visitor_id="v1")
		_log("store/a", "2026-03-11 09:00:00", visitor_id="v2")
		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ("store/a", "store/b")), (3, 2))

	def test_a_visitor_whose_first_view_predates_the_range_is_not_new_in_it(self):
		_log("store/a", "2026-02-01 09:00:00", visitor_id="v1")
		_log("store/a", "2026-03-10 09:00:00", visitor_id="v1")
		store.rebuild()

		# The first view is a property of the whole log, so March sees a returning visitor.
		self.assertEqual(store.totals(*MARCH, ("store/a",)), (1, 0))

	def test_views_without_a_visitor_id_are_never_new(self):
		_log("store/a", "2026-03-10 09:00:00")
		_log("store/a", "2026-03-10 09:01:00", visitor_id="")
		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ("store/a",)), (2, 0))

	def test_same_second_views_pick_one_first_view_by_name(self):
		names = sorted(_log("store/a", "2026-03-10 09:00:00", visitor_id="v1") for _ in range(3))
		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ("store/a",)), (3, 1))
		self.assertEqual(len(set(names)), 3)

	def test_range_is_inclusive_of_both_days(self):
		_log("store/a", "2026-02-28 23:59:59")
		_log("store/a", "2026-03-01 00:00:00")
		_log("store/a", "2026-03-31 23:59:59")
		_log("store/a", "2026-04-01 00:00:00")
		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ("store/a",))[0], 2)

	def test_referrer_host_keeps_the_port_and_skips_non_urls(self):
		_log("store/a", "2026-03-10 09:00:00", referrer="https://www.google.com/search?q=a")
		_log("store/a", "2026-03-10 09:01:00", referrer="https://www.google.com/")
		_log("store/a", "2026-03-10 09:02:00", referrer="http://localhost:8000/docs")
		_log("store/a", "2026-03-10 09:03:00", referrer="not a url")
		_log("store/a", "2026-03-10 09:04:00", referrer="")
		store.rebuild()

		hosts = store.top_referrers(*MARCH, ("store/a",), "excluded.example.com", 10)

		self.assertEqual(hosts, [("", 2), ("www.google.com", 2), ("localhost:8000", 1)])

	def test_own_host_is_dropped_from_referrers(self):
		_log("store/a", "2026-03-10 09:00:00", referrer="https://wiki.example.com/store/b")
		_log("store/a", "2026-03-10 09:01:00", referrer="https://github.com/frappe/wiki")
		store.rebuild()

		hosts = store.top_referrers(*MARCH, ("store/a",), "wiki.example.com", 10)

		self.assertEqual(hosts, [("github.com", 1)])

	def test_weekly_buckets_start_on_monday(self):
		_log("store/a", "2026-03-03 09:00:00")  # Tuesday
		_log("store/a", "2026-03-09 00:00:00")  # the next Monday
		store.rebuild()

		buckets = store.series(*MARCH, ("store/a",), "weekly")

		self.assertEqual(sorted(buckets), [getdate("2026-03-02"), getdate("2026-03-09")])

	def test_an_empty_scope_counts_nothing(self):
		_log("store/a", "2026-03-10 09:00:00")
		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ()), (0, 0))
		self.assertEqual(store.top_paths(*MARCH, (), 10), [])

	def test_ingest_picks_up_a_row_logged_in_the_same_second_as_the_last_one_mirrored(self):
		# Dated past every other row on the site, so the mirror's high-water mark is store/a.
		_log("store/a", "2031-03-10 09:00:00")
		store.rebuild()

		# Names are random, so store/b may sort either side of store/a inside that second.
		_log("store/b", "2031-03-10 09:00:00")

		self.assertEqual(store.ingest(), 1)
		self.assertEqual(store.ingest(), 0)
		self.assertEqual(store.totals(*MARCH_2031, ("store/a", "store/b"))[0], 2)

	def test_ingest_derives_again_when_the_derived_table_is_short(self):
		_log("store/a", "2031-03-10 09:00:00")
		store.rebuild()

		# What an upgrade leaves behind: rows mirrored, nothing derived from them yet.
		with store.writer() as db:
			db.execute(f"DELETE FROM {store.DERIVED}")

		self.assertEqual(store.totals(*MARCH_2031, ("store/a",))[0], 0)

		store.ingest()

		self.assertEqual(store.totals(*MARCH_2031, ("store/a",))[0], 1)

	def test_ingest_cannot_see_a_backdated_row_but_rebuild_can(self):
		_log("store/a", "2031-03-10 09:00:00")
		store.rebuild()

		# Behind the high-water mark: the incremental path never looks this far back.
		_log("store/b", "2026-03-10 09:00:00")

		self.assertEqual(store.ingest(), 0)
		self.assertEqual(store.totals(*MARCH, ("store/b",))[0], 0)

		store.rebuild()

		self.assertEqual(store.totals(*MARCH, ("store/b",))[0], 1)
