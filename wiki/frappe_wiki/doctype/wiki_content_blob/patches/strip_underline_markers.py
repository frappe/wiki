"""Strip `++…++` underline markers left behind by the editor before #667.

StarterKit's Underline mark serialized to `++text++`, which neither the server
renderer nor the Vue viewer understands, so readers saw literal plus signs.
The editor no longer writes them; this cleans up content saved before that.
Code spans, fenced blocks and data URIs are left alone so `i++` and base64
image data survive.
"""

import re

import frappe

from wiki.frappe_wiki.doctype.wiki_content_blob.patches.unescape_iframe_embeds import (
	_replace_blob_content,
)
from wiki.frappe_wiki.doctype.wiki_document.wiki_document import clear_wiki_content_cache
from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import enqueue_reindex

# Code fences, code spans and data URIs match first and are returned as-is.
MARKUP = re.compile(
	r"(?P<fence>`{3,}|~{3,})[\s\S]*?(?P=fence)"
	r"|(?P<tick>`+)[^\n]*?(?P=tick)"
	r"|data:[^)\s]*"
	r"|(?<![+/=])\+\+(?=\S)(?P<text>[^+\n]*?\S)\+\+(?![+/=])"
)


def execute():
	fixed_documents = []
	for row in _rows_with_markers("Wiki Document"):
		fixed = strip_underline_markers(row.content)
		if fixed != row.content:
			frappe.db.set_value("Wiki Document", row.name, "content", fixed, update_modified=False)
			fixed_documents.append(row.name)

	fixed_blobs = {}
	for row in _rows_with_markers("Wiki Content Blob"):
		fixed = strip_underline_markers(row.content)
		if fixed != row.content:
			fixed_blobs[row.name] = fixed

	if fixed_blobs:
		# Read before replacing: a hash collision deletes the blob. Either way the
		# blob hash changes, so these revisions' tree hashes are now wrong.
		stale_revisions = frappe.get_all(
			"Wiki Revision Item",
			filters={"content_blob": ("in", list(fixed_blobs))},
			pluck="revision",
			distinct=True,
		)
		for name, fixed in fixed_blobs.items():
			_replace_blob_content(name, fixed)
		if stale_revisions:
			# Overlays inherit their parent's items, so their hashes change too.
			stale_revisions += frappe.get_all(
				"Wiki Revision", filters={"parent_revision": ("in", stale_revisions)}, pluck="name"
			)
			frappe.db.set_value("Wiki Revision", {"name": ("in", stale_revisions)}, "hashes_stale", 1)

	clear_wiki_content_cache()
	# Raw set_value skips on_update, which is what normally re-indexes search.
	if fixed_documents:
		enqueue_reindex(fixed_documents)


def strip_underline_markers(content: str) -> str:
	return MARKUP.sub(lambda match: match["text"] or match[0], content)


def _rows_with_markers(doctype: str):
	return frappe.get_all(doctype, filters={"content": ("like", "%++%")}, fields=["name", "content"])
