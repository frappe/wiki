# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

from __future__ import unicode_literals
import frappe


def after_install():
	# create the wiki homepage
	page = frappe.new_doc("Wiki Page")
	page.title = "Home"
	page.content = "Welcome to the homepage of your wiki!"
	page.published = True
	page.insert()

	# create the wiki sidebar
	sidebar = frappe.new_doc("Website Sidebar")
	sidebar.title = "Wiki Sidebar"
	sidebar.append(
		"sidebar_items", {"title": "Home", "route": "/wiki/home", "group": "Pages"}
	)
	sidebar.append(
		"sidebar_items",
		{
			"title": "Edit Sidebar",
			"route": "/desk#Form/Website Sidebar/Wiki Sidebar",
			"group": "Manage Wiki",
		},
	)
	sidebar.append(
		"sidebar_items",
		{"title": "Settings", "route": "/desk#Form/Wiki Settings", "group": "Manage Wiki"},
	)
	sidebar.insert()

	# set the sidebar in settings
	settings = frappe.get_single("Wiki Settings")
	settings.sidebar = "Wiki Sidebar"
	settings.save()
