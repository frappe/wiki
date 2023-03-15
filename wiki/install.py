# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def after_install():
	# create the wiki homepage
	page = frappe.new_doc("Wiki Page")
	page.title = "Home"
	page.route = "home"
	page.content = "Welcome to the homepage of your wiki!"
	page.published = True
	page.insert()

	# create the wiki sidebar
	sidebar = frappe.new_doc("Wiki Sidebar")
	sidebar.wiki_page = page.name
	sidebar.parent_label = "Wiki"
	sidebar.parent = "Wiki Settings"
	sidebar.parenttype = "Wiki Settings"
	sidebar.parentfield = "wiki_sidebar"
	sidebar.insert()
