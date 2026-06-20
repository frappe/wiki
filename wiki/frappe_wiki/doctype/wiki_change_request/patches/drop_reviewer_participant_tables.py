"""Drop the abandoned Wiki CR Reviewer / Wiki CR Participant child doctypes.

The review-flow revamp replaces the never-populated custom reviewer/participant
tables with Frappe's native assignment. Remove the leftover DocTypes (and their
child tables) so nothing references the deleted JSON definitions.
"""

import frappe


def execute():
	for doctype in ("Wiki CR Reviewer", "Wiki CR Participant"):
		if frappe.db.exists("DocType", doctype):
			frappe.delete_doc("DocType", doctype, force=True, ignore_missing=True)
