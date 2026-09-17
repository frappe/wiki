"""Point the Wiki desktop icon at /wiki-app on sites still holding the pre-rename /wiki link."""

import frappe


def execute():
	frappe.db.set_value(
		"Desktop Icon",
		{"app": "wiki", "icon_type": "App", "link": "/wiki"},
		"link",
		"/wiki-app",
	)
