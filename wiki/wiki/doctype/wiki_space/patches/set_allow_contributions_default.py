# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Backfill ``allow_contributions`` to 1 on existing Wiki Spaces.

The field defaults to 1 for new spaces, but a newly added column leaves existing
rows NULL. Contributions were always allowed before this toggle existed, so set
every existing space to accept contributions to preserve behavior.
"""

import frappe


def execute():
	if not frappe.db.has_column("Wiki Space", "allow_contributions"):
		return

	wiki_space = frappe.qb.DocType("Wiki Space")
	(
		frappe.qb.update(wiki_space)
		.set(wiki_space.allow_contributions, 1)
		.where(wiki_space.allow_contributions.isnull())
	).run()
