# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def after_install():
	# create the wiki space
	# Note: route "docs" is used instead of "wiki" to avoid conflict with the app's base URL /wiki
	space = frappe.new_doc("Wiki Space")
	space.space_name = "Wiki"
	space.route = "docs"
	space.insert()

	page = frappe.new_doc("Wiki Document")
	page.parent_wiki_document = space.root_group
	page.title = "Welcome to Frappe Wiki"
	page.content = "# Welcome to Frappe Wiki!"
	page.insert()
