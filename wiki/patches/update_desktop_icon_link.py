"""Point the Wiki desktop icon at /wiki-app on sites still holding the pre-rename /wiki link."""

import frappe


def execute():
	# Desktop Icon has no icon_type column before Frappe v16.
	if not frappe.db.has_column("Desktop Icon", "icon_type"):
		return
	frappe.db.set_value(
		"Desktop Icon",
		{"app": "wiki", "icon_type": "App", "link": "/wiki"},
		"link",
		"/wiki-app",
	)
