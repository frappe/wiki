# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def after_install():
	# create the wiki space
	# The app itself lives at /wiki-app, so "wiki" is free -- "docs" is just a
	# friendlier default for a fresh site.
	space = frappe.new_doc("Wiki Space")
	space.space_name = "Wiki"
	space.route = "docs"
	space.insert()

	page = frappe.new_doc("Wiki Document")
	page.parent_wiki_document = space.root_group
	page.title = "Welcome to Frappe Wiki"
	page.content = "# Welcome to Frappe Wiki!"
	page.insert()
