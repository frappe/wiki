"""Archive the empty drafts opening a space used to create.

Every author who ever opened a space got a "Draft Changes - <space>" draft. With
explicit Edit they would all land in edit mode, so the ones with no changes go.
"""

import frappe

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	_archive_stale_draft,
	has_revision_changes,
)


def execute():
	drafts = frappe.get_all(
		"Wiki Change Request",
		filters={"status": "Draft"},
		fields=["name", "base_revision", "head_revision"],
	)
	for draft in drafts:
		if not has_revision_changes(draft.base_revision, draft.head_revision):
			_archive_stale_draft(draft)
