# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from datetime import date

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, getdate, nowdate

from wiki.api.analytics import count_views, count_views_by_path


class WikiPageViewDaily(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		date: DF.Date
		new_visitors: DF.Int
		path: DF.Data | None
		referrer_host: DF.Data | None
		views: DF.Int
	# end: auto-generated types

	pass


def on_doctype_update():
	# Covers every analytics query, so none of them reads the table rows: at a million views
	# that took the wiki-wide 180 day request from 9s to 2.4s on a 128MB buffer pool.
	frappe.db.add_index(
		"Wiki Page View Daily",
		["path", "date", "referrer_host", "views", "new_visitors"],
		index_name="analytics_covering_index",
	)


def ensure_web_page_view_index():
	# The rollup finds a visitor's first view by probing for an older row of the same visitor.
	frappe.db.add_index("Web Page View", ["visitor_id", "creation"])


def roll_up_recent_days():
	"""Scheduled: yesterday is redone too, since rows wait in Redis for up to 15 minutes."""
	today = getdate(nowdate())
	roll_up_days([add_days(today, -1), today])


def roll_up_all_logged_days():
	days = frappe.db.sql("SELECT DISTINCT DATE(creation) FROM `tabWeb Page View` ORDER BY 1", pluck=True)
	roll_up_days(days, commit_each=True)


def roll_up_days(days: list[date], commit_each: bool = False):
	for day in days:
		roll_up_day(getdate(day))
		if commit_each:
			frappe.db.commit()  # nosemgrep: a backfill over months of log must not be one transaction


def roll_up_day(day: date):
	"""Replace one day's rollup rows, so a day can be rolled up again at any time."""
	# After commit, not now: a request between now and the commit would cache the old rows again.
	frappe.db.after_commit.add(count_views.clear_cache)
	frappe.db.after_commit.add(count_views_by_path.clear_cache)

	values = {"day": day, "next_day": add_days(day, 1)}
	frappe.db.sql("DELETE FROM `tabWiki Page View Daily` WHERE date = %(day)s", values)
	# Frappe's is_unique is not used: make_view_log checks the database for the visitor, but
	# earlier views of the same visit may still be waiting in Redis, so all of them look new.
	frappe.db.sql(
		"""
		INSERT INTO `tabWiki Page View Daily`
			(name, creation, modified, owner, modified_by, date, path, referrer_host, views, new_visitors)
		SELECT UUID(), NOW(6), NOW(6), 'Administrator', 'Administrator', %(day)s,
			path, referrer_host, COUNT(*), SUM(is_first_view)
		FROM (
			SELECT
				view.path,
				CASE WHEN view.referrer LIKE '%%://%%'
					THEN SUBSTRING_INDEX(SUBSTRING_INDEX(view.referrer, '/', 3), '/', -1)
					ELSE ''
				END AS referrer_host,
				IFNULL(view.visitor_id, '') != '' AND NOT EXISTS (
					SELECT 1 FROM `tabWeb Page View` earlier
					WHERE earlier.visitor_id = view.visitor_id
						AND (earlier.creation < view.creation
							OR (earlier.creation = view.creation AND earlier.name < view.name))
				) AS is_first_view
			FROM `tabWeb Page View` view
			WHERE view.creation >= %(day)s AND view.creation < %(next_day)s
		) day_views
		GROUP BY path, referrer_host
		""",
		values,
	)
