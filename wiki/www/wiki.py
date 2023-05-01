# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def get_context(context):
	"""Find and route to the default wiki space's route, which will further route to it's first wiki page"""

	default_space_route = frappe.get_single("Wiki Settings").default_wiki_space

	if default_space_route:
		frappe.response.location = f"/{default_space_route}"
		frappe.response.type = "redirect"
		raise frappe.Redirect
