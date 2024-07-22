import frappe


def execute():
	if not frappe.db.table_exists("Wiki Feedback Item"):
		return

	for d in frappe.db.sql("select * from `tabWiki Feedback Item`", as_dict=True):
		if not d.parent:
			continue

		wiki_page = frappe.db.get_value("Wiki Feedback", d.parent, "wiki_page")

		if not wiki_page:
			continue

		doc = frappe.get_doc(
			dict(
				doctype="Wiki Feedback",
				status="Open",
				wiki_page=wiki_page,
				rating=d.rating,
				feedback=d.feedback,
				email_id=d.email_id,
			)
		).insert()

		frappe.db.set_value("Wiki Feedback", doc.name, "creation", d.creation)
		frappe.db.set_value("Wiki Feedback", doc.name, "modified", d.modified, update_modified=False)

		# delete old
		frappe.delete_doc("Wiki Feedback", d.parent)
