"""Decode HTML entities left inside fenced code blocks by the v2 editor.

Pages saved through the v2 editor stored `<`, `>` and `&` inside code fences as
`&lt;`, `&gt;` and `&amp;`. Markdown never decodes entities inside code, so
both the reader and the editor show them literally (`http://&lt;base-url&gt;`).

Fences mixing raw and escaped characters are decoded too: on the Frappe docs
they are all half-fixed corruption (`&amp;&amp;` next to a raw `=>`), not
examples of escaping.
"""

import re

import frappe
from frappe.query_builder import DocType

from wiki.frappe_wiki.doctype.wiki_content_blob.patches.unescape_iframe_embeds import (
	_replace_blob_content,
)
from wiki.frappe_wiki.doctype.wiki_document.wiki_document import clear_wiki_content_cache

FENCE_RE = re.compile(
	r"^(?P<open>[ \t]*(?P<fence>`{3,}|~{3,})[^\n]*\n)(?P<body>.*?)(?P<close>^[ \t]*(?P=fence)[`~]*[ \t]*$)",
	re.MULTILINE | re.DOTALL,
)
ENTITY_FILTERS = [["content", "like", f"%&{entity};%"] for entity in ("lt", "gt", "amp")]


def execute():
	fix_content_blobs()
	fix_wiki_documents()


def fix_content_blobs():
	fixes = {}
	for blob in frappe.get_all("Wiki Content Blob", or_filters=ENTITY_FILTERS, fields=["name", "content"]):
		fixed = unescape_code_blocks(blob.content)
		if fixed != blob.content:
			fixes[blob.name] = fixed
	if not fixes:
		return

	# Revision content hashes are built from blob hashes, so they must be recomputed.
	# One lookup for all blobs: content_blob has no index and the item table is large.
	stale_revisions = frappe.get_all(
		"Wiki Revision Item",
		filters={"content_blob": ("in", list(fixes))},
		pluck="revision",
		distinct=True,
	)
	# Overlays hash the items they inherit from their base, but have no item rows for them.
	if stale_revisions:
		stale_revisions += frappe.get_all(
			"Wiki Revision",
			filters={"is_overlay": 1, "parent_revision": ("in", stale_revisions)},
			pluck="name",
		)
	for name, fixed in fixes.items():
		_replace_blob_content(name, fixed)

	if stale_revisions:
		WikiRevision = DocType("Wiki Revision")
		frappe.qb.update(WikiRevision).set(WikiRevision.hashes_stale, 1).where(
			WikiRevision.name.isin(stale_revisions)
		).run()


def fix_wiki_documents():
	changed = False
	for document in frappe.get_all("Wiki Document", or_filters=ENTITY_FILTERS, fields=["name", "content"]):
		fixed = unescape_code_blocks(document.content)
		if fixed == document.content:
			continue
		frappe.db.set_value("Wiki Document", document.name, "content", fixed, update_modified=False)
		changed = True

	if changed:
		clear_wiki_content_cache()


def unescape_code_blocks(content: str) -> str:
	return FENCE_RE.sub(
		lambda match: match["open"] + unescape_code(match["body"]) + match["close"],
		content,
	)


def unescape_code(code: str) -> str:
	# `&amp;` goes last so `&amp;lt;` decodes one level to `&lt;`, not to `<`.
	return code.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
