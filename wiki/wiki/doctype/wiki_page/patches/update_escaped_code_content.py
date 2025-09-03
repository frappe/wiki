import frappe


def execute():
	wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "content"])
	for page in wiki_pages:
		markdown_content = (
			page["content"]
			.replace("&#96;", "`")
			.replace("&#36;{", "${")
			.replace("&gt;", ">")
			.replace("&lt;", "<")
		)
		frappe.db.set_value("Wiki Page", page["name"], "content", markdown_content)
