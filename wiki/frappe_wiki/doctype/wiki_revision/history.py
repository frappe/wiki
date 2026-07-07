# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Read endpoints for a single page's published version history.

A page's history is the set of published space snapshots (`Wiki Revision` with
`is_working = 0` and `is_overlay = 0`) in which that page changed. We reconstruct
it by materializing the page's item in each published revision, in time order,
and emitting an entry only when the page actually changed — never by walking the
`parent_revision` chain, which skips concurrently-merged revisions (see the spec
`specs/page_version_history_ui.md`).
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _

# Content-identical revisions where one of these differs count as a "renamed"
# style entry (a rename, move, route change, or (un)publish) rather than an edit.
_TRACKED_META_FIELDS = (
	"title",
	"slug",
	"route",
	"parent_key",
	"is_published",
	"is_external_link",
	"external_url",
)

_ITEM_FIELDS = [
	"revision",
	"title",
	"slug",
	"route",
	"parent_key",
	"is_published",
	"is_external_link",
	"external_url",
	"is_deleted",
	"content_blob",
]


@frappe.whitelist()
def get_page_history(page: str) -> list[dict[str, Any]]:
	"""Newest-first list of published revisions in which `page` changed.

	`page` is a `Wiki Document.name` (the `:pageId` route param). Gated on
	contribute capability — this is an editor tool, not a reader feature.
	"""
	doc_key, wiki_space = _resolve_page(page)
	timeline = _load_page_timeline(doc_key, wiki_space)
	return _to_history_entries(timeline)


@frappe.whitelist()
def diff_page_revisions(page: str, revision: str, base_revision: str | None = None) -> dict[str, Any]:
	"""Diff `page` between `revision` and its predecessor.

	When `base_revision` is omitted the predecessor is the previous history
	entry's revision (the last published revision before `revision` where the
	page changed); no predecessor means the page was added, so `base` is None.
	Mirrors `diff_change_request(scope="page")` so `DiffViewer.vue` consumes it
	unchanged.
	"""
	doc_key, wiki_space = _resolve_page(page)

	if base_revision is None:
		base_revision = _predecessor_revision(doc_key, wiki_space, revision)

	head = _resolve_page_at_revision(revision, doc_key)
	base = _resolve_page_at_revision(base_revision, doc_key) if base_revision else None
	return {"doc_key": doc_key, "base": base, "head": head}


# --- Resolution + permission gate --------------------------------------------


def _resolve_page(page: str) -> tuple[str, str]:
	"""Resolve a Wiki Document name to (doc_key, wiki_space) and gate access.

	Centralizes the space lookup and the permission check for both endpoints.
	Editors gate: `can_contribute_to_space`, not `can_read_space`.
	"""
	row = frappe.db.get_value("Wiki Document", page, ["doc_key", "wiki_space"], as_dict=True)
	if not row:
		frappe.throw(_("Page not found."), frappe.DoesNotExistError)

	doc_key = row.doc_key
	wiki_space = row.wiki_space
	if not wiki_space:
		# `wiki_space` isn't always denormalized onto the document; fall back to
		# the nested-set root-group lookup (mirrors WikiDocument.check_space_access).
		wiki_space = (frappe.get_doc("Wiki Document", page).get_wiki_space() or {}).get("name")

	if not doc_key or not wiki_space:
		frappe.throw(_("This page has no version history yet."))

	from wiki.permissions import can_contribute_to_space

	if not can_contribute_to_space(wiki_space):
		frappe.throw(
			_("You are not allowed to view this page's history."),
			frappe.PermissionError,
		)
	return doc_key, wiki_space


# --- Timeline reconstruction -------------------------------------------------


def _published_revisions(wiki_space: str) -> list[dict[str, Any]]:
	"""Time-ordered published snapshots of a space (oldest first).

	This is the exact set of published states — bootstrap, git-sync advances, and
	CR merges. Overlay/working revisions are excluded, so unmerged drafts never
	leak. `creation` breaks ties when two revisions share a `created_at` second.
	"""
	return frappe.get_all(
		"Wiki Revision",
		filters={"wiki_space": wiki_space, "is_working": 0, "is_overlay": 0},
		fields=["name", "change_request", "message", "created_by", "created_at"],
		order_by="created_at asc, creation asc",
	)


def _load_page_timeline(doc_key: str, wiki_space: str) -> list[dict[str, Any]]:
	"""Ordered (oldest-first) list of revisions in which the page changed.

	Walks the published snapshot set, comparing each revision's item for the page
	against the previous one that contained it. Diffing consecutive materialized
	states is correct even across the merge-parent quirk: a three-way merge builds
	its item set from current main, so M(prev) -> M(next) shows exactly what that
	merge changed for the page.
	"""
	revisions = _published_revisions(wiki_space)
	if not revisions:
		return []

	rev_names = [rev.name for rev in revisions]
	items = frappe.get_all(
		"Wiki Revision Item",
		filters={"revision": ("in", rev_names), "doc_key": doc_key},
		fields=_ITEM_FIELDS,
	)
	_attach_content_hashes(items)
	item_by_rev = {item.revision: item for item in items}

	timeline: list[dict[str, Any]] = []
	prev: dict[str, Any] | None = None  # last revision in which the page was present
	for rev in revisions:
		item = item_by_rev.get(rev.name)
		present = bool(item) and not item.get("is_deleted")
		change_type = _classify(prev, item, present)
		if change_type:
			snapshot = item if present else prev
			timeline.append(
				{
					"revision": rev.name,
					"change_request": rev.change_request,
					"message": rev.message,
					"created_by": rev.created_by,
					"created_at": rev.created_at,
					"change_type": change_type,
					"title": (snapshot or {}).get("title"),
				}
			)
		prev = item if present else None
	return timeline


def _classify(prev: dict[str, Any] | None, item: dict[str, Any] | None, present: bool) -> str | None:
	"""Change type of `item` relative to the page's previous present state.

	Returns None when nothing about the page changed (deduped away).
	"""
	if present and prev is None:
		return "added"
	if present and prev is not None:
		if _content_key(item) != _content_key(prev):
			return "edited"
		if _meta_key(item) != _meta_key(prev):
			return "renamed"
		return None
	if not present and prev is not None:
		return "deleted"
	return None


def _content_key(item: dict[str, Any]) -> str:
	# Prefer the blob hash (dedup key); fall back to the blob name so identical
	# content always collapses even if a hash is somehow missing.
	return item.get("content_hash") or item.get("content_blob") or ""


def _meta_key(item: dict[str, Any]) -> tuple:
	return tuple(item.get(field) for field in _TRACKED_META_FIELDS)


def _attach_content_hashes(items: list[dict[str, Any]]) -> None:
	blob_names = {item.content_blob for item in items if item.get("content_blob")}
	hashes: dict[str, str] = {}
	if blob_names:
		hashes = {
			blob.name: blob.hash
			for blob in frappe.get_all(
				"Wiki Content Blob",
				fields=["name", "hash"],
				filters={"name": ("in", list(blob_names))},
			)
		}
	for item in items:
		item["content_hash"] = hashes.get(item.get("content_blob"))


# --- Diff resolution ---------------------------------------------------------


def _predecessor_revision(doc_key: str, wiki_space: str, revision: str) -> str | None:
	"""The published revision the page changed in just before `revision`."""
	timeline = _load_page_timeline(doc_key, wiki_space)
	revs = [entry["revision"] for entry in timeline]
	if revision in revs:
		index = revs.index(revision)
		return revs[index - 1] if index > 0 else None

	# `revision` isn't itself a change point (the UI never sends one, but stay
	# robust): pick the last change strictly before it in time.
	target_created = frappe.db.get_value("Wiki Revision", revision, "created_at")
	predecessor = None
	for entry in timeline:
		if entry["created_at"] and target_created and entry["created_at"] < target_created:
			predecessor = entry["revision"]
	return predecessor


def _resolve_page_at_revision(revision: str, doc_key: str) -> dict[str, Any] | None:
	"""Materialize the page's content + key metadata at a published revision.

	None when the page is absent or deleted there (an empty side of the diff).
	Published revisions are full (non-overlay) snapshots, so a direct item lookup
	resolves the state — no overlay inheritance to walk.
	"""
	item = frappe.db.get_value(
		"Wiki Revision Item",
		{"revision": revision, "doc_key": doc_key},
		["title", "route", "is_published", "content_blob", "is_deleted"],
		as_dict=True,
	)
	if not item or item.is_deleted:
		return None

	content = ""
	if item.content_blob:
		content = frappe.db.get_value("Wiki Content Blob", item.content_blob, "content") or ""

	return {
		"title": item.title,
		"content": content,
		"route": item.route,
		"is_published": item.is_published,
	}


# --- Enrichment --------------------------------------------------------------


def _to_history_entries(timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
	"""Newest-first display entries with CR titles and author details resolved."""
	entries = list(reversed(timeline))

	cr_names = {entry["change_request"] for entry in entries if entry["change_request"]}
	cr_titles: dict[str, str] = {}
	if cr_names:
		cr_titles = {
			cr.name: cr.title
			for cr in frappe.get_all(
				"Wiki Change Request",
				filters={"name": ("in", list(cr_names))},
				fields=["name", "title"],
			)
		}

	user_names = {entry["created_by"] for entry in entries if entry["created_by"]}
	users: dict[str, Any] = {}
	if user_names:
		users = {
			user.name: user
			for user in frappe.get_all(
				"User",
				filters={"name": ("in", list(user_names))},
				fields=["name", "full_name", "user_image"],
			)
		}

	result: list[dict[str, Any]] = []
	for entry in entries:
		author = users.get(entry["created_by"]) or {}
		result.append(
			{
				"revision": entry["revision"],
				"change_request": entry["change_request"],
				"cr_title": cr_titles.get(entry["change_request"]),
				"message": entry["message"],
				"change_type": entry["change_type"],
				"title": entry["title"],
				"author": {
					"name": entry["created_by"],
					"full_name": author.get("full_name") or entry["created_by"],
					"user_image": author.get("user_image"),
				},
				"timestamp": entry["created_at"],
			}
		)
	return result
