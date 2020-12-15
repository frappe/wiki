# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

from __future__ import unicode_literals
import frappe


def get_context(context):
	res = frappe.db.get_all(
		"Wiki Page",
		filters={"route": ("is", "set")},
		fields=["name", "route"],
		order_by="creation asc",
		limit=1,
	)
	wiki_page = res[0] if res else None
	# find and route to the first wiki page
	if wiki_page:
		frappe.response.location = wiki_page.route
		frappe.response.type = "redirect"
		raise frappe.Redirect
