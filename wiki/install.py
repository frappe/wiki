# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe import _


def after_install():
	# create the wiki homepage
	page = frappe.new_doc("Wiki Page")
	page.title = _("Home")
	page.route = "wiki/home"
	page.content = _("Welcome to the homepage of your wiki!")
	page.published = True
	page.insert()

	# create the wiki space
	space = frappe.new_doc("Wiki Space")
	space.route = "wiki"
	space.insert()

	# create the wiki sidebar
	sidebar = frappe.new_doc("Wiki Group Item")
	sidebar.wiki_page = page.name
	sidebar.parent_label = _("Wiki")
	sidebar.parent = space.name
	sidebar.parenttype = "Wiki Space"
	sidebar.parentfield = "wiki_sidebars"
	sidebar.insert()
