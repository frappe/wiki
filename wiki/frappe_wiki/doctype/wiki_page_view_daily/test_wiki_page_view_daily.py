# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from wiki.frappe_wiki.doctype.wiki_page_view_daily.wiki_page_view_daily import roll_up_day

PATH = "rollup-test/page"


def _log_view(creation: str, visitor_id: str | None = None, referrer: str | None = None, path: str = PATH):
	view = frappe.get_doc(
		{
			"doctype": "Web Page View",
			"path": path,
			"visitor_id": visitor_id,
			"referrer": referrer,
			# What make_view_log stores for every view that was still in Redis at the time.
			"is_unique": 1,
		}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Web Page View", view.name, "creation", creation, update_modified=False)


def _rollup(day: str) -> list[list]:
	rows = frappe.get_all(
		"Wiki Page View Daily",
		filters={"date": day, "path": ("like", "rollup-test%")},
		fields=["path", "referrer_host", "views", "new_visitors"],
		order_by="path, referrer_host",
		as_list=True,
	)
	return [list(row) for row in rows]


class TestRollUpDay(IntegrationTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_a_visitor_is_new_only_on_their_first_view(self):
		_log_view("2026-03-10 09:00:00", "v1")
		_log_view("2026-03-10 09:01:00", "v1")
		_log_view("2026-03-11 09:00:00", "v1")
		# Two views in the same second: exactly one of them is first.
		_log_view("2026-03-10 10:00:00", "v2")
		_log_view("2026-03-10 10:00:00", "v2")
		# No visitor id (or an empty one) is never counted as a visitor.
		_log_view("2026-03-10 11:00:00")
		_log_view("2026-03-10 11:00:00", "")

		roll_up_day("2026-03-10")
		roll_up_day("2026-03-11")

		self.assertEqual(_rollup("2026-03-10"), [[PATH, "", 6, 2]])
		self.assertEqual(_rollup("2026-03-11"), [[PATH, "", 1, 0]])

	def test_rows_group_by_path_and_referrer_host(self):
		_log_view("2026-03-10 09:00:00", referrer="https://www.google.com/search")
		_log_view("2026-03-10 09:01:00", referrer="https://www.google.com/")
		_log_view("2026-03-10 09:02:00", referrer="http://localhost:8000/docs/intro")
		_log_view("2026-03-10 09:03:00", referrer="android-app://com.slack")
		_log_view("2026-03-10 09:04:00", referrer="not a url")
		_log_view("2026-03-10 09:05:00", path="rollup-test/other")

		roll_up_day("2026-03-10")

		self.assertEqual(
			_rollup("2026-03-10"),
			[
				["rollup-test/other", "", 1, 0],
				[PATH, "", 1, 0],
				[PATH, "com.slack", 1, 0],
				[PATH, "localhost:8000", 1, 0],
				[PATH, "www.google.com", 2, 0],
			],
		)

	def test_rolling_up_again_replaces_the_day_and_sees_late_rows(self):
		_log_view("2026-03-11 08:00:00", "v1")
		roll_up_day("2026-03-11")
		self.assertEqual(_rollup("2026-03-11"), [[PATH, "", 1, 1]])

		# A view from the day before arrives late, as rows still waiting in Redis do.
		_log_view("2026-03-10 23:59:00", "v1")
		roll_up_day("2026-03-10")
		roll_up_day("2026-03-11")

		self.assertEqual(_rollup("2026-03-10"), [[PATH, "", 1, 1]])
		self.assertEqual(_rollup("2026-03-11"), [[PATH, "", 1, 0]])
