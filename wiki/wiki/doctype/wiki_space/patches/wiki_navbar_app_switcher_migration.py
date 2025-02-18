import frappe


def execute():
	wiki_spaces = frappe.db.get_all("Wiki Space", fields=["*"])
	for space in wiki_spaces:
		if space["space_name"] is None:
			frappe.db.set_value(
				"Wiki Space", space["name"], "space_name", space["route"].replace("/", " ").capitalize()
			)
