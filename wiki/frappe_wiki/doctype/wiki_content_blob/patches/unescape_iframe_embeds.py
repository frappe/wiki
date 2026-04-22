"""One-off fix for GitHub issue frappe/wiki#599.

Before the TipTap editor gained a dedicated iframe extension, pasting a YouTube
embed landed in the ProseMirror document as a text node. Each edit/save cycle
re-serialized it as escaped HTML, so pages that had been saved twice ended up
with double-escaped iframe HTML (``&amp;lt;iframe&amp;gt;``) in their
Wiki Content Blob content. This patch walks those blobs and unescapes them
until they match a real iframe tag again.

Only blobs where the double-escape marker ``&amp;lt;iframe`` appears are
touched — single-level ``&lt;iframe`` is left alone because that sequence can
legitimately appear in a tutorial about escaping HTML.
"""

import hashlib
import html

import frappe

DOUBLE_ESCAPE_MARKER = "&amp;lt;iframe"


def execute():
	rows = frappe.db.sql(
		"""
		SELECT name, content
		FROM `tabWiki Content Blob`
		WHERE content LIKE %s
		""",
		(f"%{DOUBLE_ESCAPE_MARKER}%",),
		as_dict=True,
	)

	if not rows:
		return

	for row in rows:
		fixed = _reduce_escape(row["content"] or "")
		if fixed == row["content"]:
			continue
		_replace_blob_content(row["name"], fixed)


def _reduce_escape(content: str) -> str:
	"""Fully unescape a string that was HTML-escaped one or more times.

	Entry to the patch is gated on the double-escape marker, so the first pass
	always changes the content. We then keep unescaping until the string
	stabilises or hits a safety cap (handles content escaped 3+ times without
	risking a runaway loop on pathological input).
	"""
	current = content
	for _ in range(8):
		reduced = html.unescape(current)
		if reduced == current:
			break
		current = reduced
	return current


def _replace_blob_content(name: str, new_content: str) -> None:
	"""Rewrite a blob's content + hash + size. If another blob already has the
	target hash (revision items already point there), redirect references and
	delete the duplicate instead.
	"""
	new_hash = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
	new_size = len(new_content.encode("utf-8"))

	collision = frappe.db.get_value(
		"Wiki Content Blob",
		{"hash": new_hash, "name": ("!=", name)},
		"name",
	)

	if collision:
		frappe.db.sql(
			"UPDATE `tabWiki Revision Item` SET content_blob = %s WHERE content_blob = %s",
			(collision, name),
		)
		frappe.db.delete("Wiki Content Blob", name)
		return

	frappe.db.set_value(
		"Wiki Content Blob",
		name,
		{"content": new_content, "hash": new_hash, "size": new_size},
		update_modified=False,
	)
