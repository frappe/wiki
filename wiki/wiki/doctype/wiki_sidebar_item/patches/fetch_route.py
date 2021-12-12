# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

from __future__ import unicode_literals
import frappe


def execute():
	frappe.reload_doc('Wiki', 'doctype', 'Wiki Sidebar')
	frappe.reload_doc('Wiki', 'doctype', 'Wiki Sidebar Item')
	frappe.db.sql('''
		UPDATE `tabWiki Sidebar Item` as target
		INNER JOIN `tabWiki Page` as source
		ON `target`.`item` = `source`.`name`
		SET `target`.`route` = `source`.`route`
		WHERE `target`.`type` = 'Wiki Page'
	''')
	frappe.db.commit()