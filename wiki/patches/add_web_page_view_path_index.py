import frappe


def execute():
	# Analytics filter every query by path prefix and a creation range.
	frappe.db.add_index("Web Page View", ["path", "creation"])
