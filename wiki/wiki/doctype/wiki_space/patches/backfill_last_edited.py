# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Backfill ``last_edited`` on existing Wiki Spaces.

The field moves on every page save from now on, but the column arrives NULL
for every existing space, which would sort them all to the bottom of the
sidebar. Seed it the way the directory computes last activity: the newest
``modified`` among the space's pages, falling back to the space's own
``modified`` when it has none.
"""

import frappe
from frappe.query_builder.functions import Max


def execute():
	if not frappe.db.has_column("Wiki Space", "last_edited"):
		return

	document = frappe.qb.DocType("Wiki Document")
	newest_page = dict(
		frappe.qb.from_(document)
		.select(document.wiki_space, Max(document.modified))
		.where(document.wiki_space.isnotnull())
		.groupby(document.wiki_space)
		.run()
	)

	for space in frappe.get_all("Wiki Space", fields=["name", "modified"]):
		frappe.db.set_value(
			"Wiki Space",
			space.name,
			"last_edited",
			newest_page.get(space.name) or space.modified,
			update_modified=False,
		)
