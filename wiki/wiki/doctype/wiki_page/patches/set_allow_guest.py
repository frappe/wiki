# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

from __future__ import unicode_literals
import frappe


def execute():
	# set allow_guest to 1 for all records
	frappe.db.set_value("Wiki Page", {"name": ("!=", ".")}, "allow_guest", 1)
