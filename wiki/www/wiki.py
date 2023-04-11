# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def get_context(context):
	"""Find and route to the first wiki space's route, which will further route to it's first wiki page"""

	# TODO: make this configurable
	first_wiki_space_name = frappe.get_all("Wiki Space", pluck="name")[0]
	topmost_wiki_route = frappe.get_doc("Wiki Space", first_wiki_space_name).route

	if topmost_wiki_route:
		frappe.response.location = topmost_wiki_route
		frappe.response.type = "redirect"
		raise frappe.Redirect
