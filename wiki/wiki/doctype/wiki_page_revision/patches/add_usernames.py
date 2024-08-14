import frappe


def execute():
	frappe.reload_doctype("Wiki Page Revision")

	revision = frappe.qb.DocType("Wiki Page Revision")
	user = frappe.qb.DocType("User")

	(
		frappe.qb.update(revision)
		.join(user)
		.on(user.name == revision.raised_by)
		.set(revision.raised_by_username, user.username)
	).run()
