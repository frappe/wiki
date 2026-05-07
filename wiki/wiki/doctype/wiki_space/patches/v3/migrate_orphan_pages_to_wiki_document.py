import frappe


def execute():
	for page in frappe.db.get_all("Wiki Page", pluck="name"):
		wiki_page = frappe.get_doc("Wiki Page", page)
		wiki_page._migrate_to_wiki_document()
		frappe.db.commit()
