# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document
from frappe.utils import md_to_html, pretty_date


class WikiPageRevision(Document):
	pass


@frappe.whitelist(allow_guest=True)
def get_revisions(wiki_page_name):
	revisions = frappe.db.get_all(
		"Wiki Page Revision",
		{"wiki_page": wiki_page_name},
		["content", "creation", "owner", "raised_by", "raised_by_username"],
	)

	for revision in revisions:
		revision.revision_time = pretty_date(revision.creation)
		revision.author = revision.raised_by_username or revision.raised_by or revision.owner
		revision.content = md_to_html(revision.content)
		del revision.raised_by_username
		del revision.raised_by
		del revision.creation
		del revision.owner

	return revisions
