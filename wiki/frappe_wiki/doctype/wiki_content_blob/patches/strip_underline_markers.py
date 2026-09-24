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

UNDERLINE = re.compile(r"(?<![+/=])\+\+(?=\S)([^+\n]*?\S)\+\+(?![+/=])")
PROTECTED = re.compile(r"(```[\s\S]*?```|`[^`\n]*`|data:[^)\s]*)")


def execute():
	for row in _rows_with_markers("Wiki Document"):
		fixed = strip_underline_markers(row.content)
		if fixed != row.content:
			frappe.db.set_value("Wiki Document", row.name, "content", fixed, update_modified=False)

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
			frappe.db.set_value("Wiki Revision", {"name": ("in", stale_revisions)}, "hashes_stale", 1)

	clear_wiki_content_cache()


def strip_underline_markers(content: str) -> str:
	parts = PROTECTED.split(content)
	# re.split with one capture group puts the protected spans at odd indices.
	for index in range(0, len(parts), 2):
		parts[index] = UNDERLINE.sub(r"\1", parts[index])
	return "".join(parts)


def _rows_with_markers(doctype: str):
	return frappe.get_all(doctype, filters={"content": ("like", "%++%")}, fields=["name", "content"])
