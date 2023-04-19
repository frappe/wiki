# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import pretty_date

from wiki.wiki.doctype.wiki_page.wiki_page import update


class WikiPageRevision(Document):
	pass


@frappe.whitelist(allow_guest=True)
def get_previous_revision_content(revision_name, wiki_page_name):
	previous_revision = ""
	revisions = frappe.db.get_all("Wiki Page Revision", {"wiki_page": wiki_page_name}, pluck="name")
	for i, revision in enumerate(revisions):
		if revision == revision_name:
			if i + 1 < len(revisions):
				previous_revision = revisions[i + 1]
			break

	latest_content, revision_time, owner, raised_by, raised_by_username = frappe.db.get_value(
		"Wiki Page Revision",
		revision_name,
		["content", "creation", "owner", "raised_by", "raised_by_username"],
	)
	return {
		"is_revisions": len(revisions[:-1]),
		"latest_content": latest_content,
		"revision_time": pretty_date(revision_time),
		"author": raised_by_username or raised_by or owner,
		"previous_revision": previous_revision,
		"previous_content": frappe.db.get_value("Wiki Page Revision", previous_revision, "content")
		if previous_revision
		else "",
	}


@frappe.whitelist(allow_guest=True)
def get_next_revision_content(revision_name, wiki_page_name):
	next_revision = ""
	revisions = frappe.db.get_all("Wiki Page Revision", {"wiki_page": wiki_page_name}, pluck="name")
	for i, revision in enumerate(revisions):
		if revision == revision_name:
			if i >= 1:
				next_revision = revisions[i - 1]
			break

	if next_revision:
		next_content, revision_time, owner, raised_by, raised_by_username, = frappe.db.get_value(
			"Wiki Page Revision",
			next_revision,
			["content", "creation", "owner", "raised_by", "raised_by_username"],
		)

	return {
		"is_revisions": len(revisions[:-1]),
		"latest_content": frappe.db.get_value("Wiki Page Revision", revision_name, "content"),
		"revision_time": pretty_date(revision_time),
		"author": raised_by_username or raised_by or owner,
		"next_revision": next_revision,
		"next_content": next_content if next_revision else "",
	}


@frappe.whitelist()
def restore_wiki_revision(
	wiki_revision_name, wiki_page_name, wiki_revision_message="Reverted Wiki Page"
):
	if not frappe.has_permission(doctype="Wiki Page", ptype="update", throw=False):
		frappe.throw(
			_("You are not permitted to revert the Wiki Page"),
			frappe.PermissionError,
		)

	wiki_revision_content = frappe.get_value("Wiki Page Revision", wiki_revision_name, ["content"])
	wiki_patch_title = frappe.get_value(
		"Wiki Page Patch", {"wiki_page": wiki_page_name}, ["new_title"]
	)

	update_vals = update(
		name=wiki_page_name,
		content=wiki_revision_content,
		title=wiki_patch_title,
		message=wiki_revision_message,
	)

	return update_vals.route
