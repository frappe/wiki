import frappe
from markdownify import markdownify as md

def execute():
    wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "content"])
    for page in wiki_pages:
        markdown_content = md(page['content'])
        frappe.db.set_value('Wiki Page', page['name'], 'content', markdown_content)
