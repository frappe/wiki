# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def get_context(context):
	topmost_wiki_name = frappe.get_single("Wiki Settings").wiki_sidebar[0].wiki_page
	topmost_wiki_route = frappe.get_value("Wiki Page", topmost_wiki_name, "route")

	# find and route to the first wiki page
	if topmost_wiki_route:
		frappe.response.location = topmost_wiki_route
		frappe.response.type = "redirect"
		raise frappe.Redirect
