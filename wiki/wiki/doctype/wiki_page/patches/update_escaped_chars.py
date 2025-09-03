import re

import frappe


def execute():
	wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "content"])
	for page in wiki_pages:
		frappe.db.set_value("Wiki Page", page["name"], "content", edit_content(page["content"]))


def edit_content(content):
	def replacer(match):
		code_content = match.group(0)
		#  replace inside the code block
		code_content = code_content.replace(r"\"", '"')
		code_content = code_content.replace(r"\_", "_")
		code_content = code_content.replace(r"\t", "")
		code_content = code_content.replace(r"\G", "")
		code_content = code_content.replace(r"\n", "\n")
		return code_content

	content = re.sub(r"(```[\s\S]*?```|`[^`]*`)", replacer, content)

	content = content.replace(r"\*", "*")

	return content
