# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def execute():
	frappe.db.sql(
		"""
		INSERT INTO `tabWiki Page Revision Item`
			(name, creation, modified,modified_by,owner,docstatus,parent,parentfield,parenttype,idx,wiki_page)

		SELECT name, modified, modified, modified_by, owner,
			docstatus, name , 'wiki_pages', 'Wiki Page Revision', 1, wiki_page
		FROM `tabWiki Page Revision`
	"""
	)
