# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe

from wiki.wiki.doctype.wiki_space.wiki_space import space_name_from_route


def execute():
	for space in frappe.get_all(
		"Wiki Space", filters={"space_name": ("is", "not set")}, fields=["name", "route"]
	):
		frappe.db.set_value(
			"Wiki Space",
			space.name,
			"space_name",
			space_name_from_route(space.route or space.name),
			update_modified=False,
		)
