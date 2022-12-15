# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def execute():
	frappe.reload_doctype("Wiki Page")
	# set allow_guest to 1 for all records
	frappe.db.set_value("Wiki Page", {"name": ("!=", ".")}, "allow_guest", 1)
