# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WikiMergeConflict(Document):
	pass


def on_doctype_update():
	# Open-conflict counts/listings filter by (change_request, status); see
	# get_open_conflict_count / resolved-conflict listing in wiki_change_request.py
	frappe.db.add_index("Wiki Merge Conflict", ["change_request", "status"])
