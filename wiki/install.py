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
	sidebar.title = "Wiki"
	sidebar.route = "wiki"
	sidebar.append("sidebar_items", {"item": page.name})
	sidebar.insert()

	# set the sidebar in settings
	settings = frappe.get_single("Wiki Settings")
	settings.sidebar = sidebar.name
	settings.save()
