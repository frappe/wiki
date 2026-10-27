"""Version history of a space and its pages.

A space's main chain is every revision that is neither a change request's
working copy nor an overlay: merges, git syncs, Desk edits and the first
snapshot. Git sync writes its revisions with no parent, so the chain is read in
time order rather than by walking `parent_revision`.
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	_diff_revision_items,
	rendered_changes,
	user_cards,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import get_revision_item_map
from wiki.permissions import can_read_space

PAGE_FIELDS = ("title", "route", "content_blob", "is_published", "is_deleted")


@frappe.whitelist(methods=["GET"])
def get_page_history(wiki_space: str, doc_key: str, start: int = 0, limit: int = 50) -> dict[str, Any]:
	"""The versions of one page, newest first: each main revision that changed it."""
	_check_read(wiki_space)
	versions = []
	previous = None
	for revision in _main_chain(wiki_space, doc_key):
		item = {field: revision.pop(field) for field in PAGE_FIELDS}
		changes = _page_changes(previous, item)
		if changes:
			old_title = previous["title"] if "renamed" in changes else None
			versions.append({**revision, "title": item["title"], "changes": changes, "old_title": old_title})
		previous = item
	# ponytail: reads the whole chain to find the page's versions; keep the page's versions on write (3.3) if spaces outgrow it.
	return _paginate(versions[::-1], start, limit)


@frappe.whitelist(methods=["GET"])
def get_space_history(wiki_space: str, start: int = 0, limit: int = 50) -> dict[str, Any]:
	"""The versions of the space, newest first, with how many pages each changed."""
	_check_read(wiki_space)
	chain = _distinct_states(_main_chain(wiki_space))
	result = _paginate(chain[::-1], start, limit)

	cursor = len(chain) - cint(start)
	head_items = None
	versions = []
	for revision in result["versions"]:
		cursor -= 1
		head_items = head_items or get_revision_item_map(revision["revision"])
		base_items = get_revision_item_map(chain[cursor - 1]["revision"]) if cursor else {}
		changes = _without_root(_diff_revision_items(base_items, head_items), head_items)
		if changes:
			versions.append({**revision, "page_count": len(changes)})
		head_items = base_items
	return {**result, "versions": versions}


@frappe.whitelist(methods=["GET"])
def get_revision_changes(revision: str, doc_key: str | None = None) -> dict[str, Any]:
	"""What a version changed against the one before it, rendered like the change request review."""
	row = frappe.db.get_value(
		"Wiki Revision", revision, ["wiki_space", "is_working", "is_overlay"], as_dict=True
	)
	# A working or overlay revision is someone's change request, which has its own permissions.
	if not row or row.is_working or row.is_overlay:
		frappe.throw(_("Version {0} not found").format(revision), frappe.DoesNotExistError)
	_check_read(row.wiki_space)

	names = [entry["revision"] for entry in _main_chain(row.wiki_space)]
	index = names.index(revision)
	base_items = get_revision_item_map(names[index - 1]) if index else {}
	head_items = get_revision_item_map(revision)
	pages = rendered_changes(base_items, head_items, row.wiki_space, doc_key)
	return {"pages": _without_root(pages, head_items)}


def _check_read(wiki_space: str) -> None:
	if not can_read_space(wiki_space):
		frappe.throw(_("You do not have access to this wiki space."), frappe.PermissionError)


def _main_chain(wiki_space: str, doc_key: str | None = None) -> list[dict[str, Any]]:
	"""The space's main revisions, oldest first, each with that revision's item for `doc_key` when given."""
	Revision = frappe.qb.DocType("Wiki Revision")
	ChangeRequest = frappe.qb.DocType("Wiki Change Request")
	query = (
		frappe.qb.from_(Revision)
		.left_join(ChangeRequest)
		.on(ChangeRequest.name == Revision.change_request)
		.select(
			Revision.name.as_("revision"),
			Revision.change_request,
			ChangeRequest.title.as_("change_request_title"),
			Revision.source_commit,
			Revision.is_merge,
			Revision.created_by,
			Revision.created_at,
		)
		.where(Revision.wiki_space == wiki_space)
		.where(Revision.is_working == 0)
		.where(Revision.is_overlay == 0)
		.orderby(Revision.created_at)
		.orderby(Revision.creation)
	)
	if doc_key:
		Item = frappe.qb.DocType("Wiki Revision Item")
		query = (
			query.left_join(Item)
			.on((Item.revision == Revision.name) & (Item.doc_key == doc_key))
			.select(*(Item[field] for field in PAGE_FIELDS))
		)
	else:
		query = query.select(Revision.tree_hash, Revision.content_hash)
	rows = query.run(as_dict=True)

	authors = user_cards({row.created_by for row in rows})
	return [_version(row, authors[row.created_by], is_first=index == 0) for index, row in enumerate(rows)]


def _version(row: dict[str, Any], author: dict[str, Any], is_first: bool) -> dict[str, Any]:
	if row.change_request:
		source = "merge"
	elif row.is_merge:
		source = "sync"
	elif is_first:
		source = "initial"
	else:
		source = "desk"
	version = {
		**row,
		"source": source,
		"author": {"user": row.created_by, **author},
	}
	for field in ("is_merge", "created_by"):
		version.pop(field)
	return version


def _distinct_states(chain: list[dict[str, Any]]) -> list[dict[str, Any]]:
	"""Drop revisions that left the space as it was, such as the live snapshot a git sync takes first."""
	kept = []
	for revision in chain:
		state = (revision.pop("tree_hash"), revision.pop("content_hash"))
		if not kept or state != kept[-1][0]:
			kept.append((state, revision))
	return [revision for _state, revision in kept]


def _without_root(
	changes: list[dict[str, Any]], head_items: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
	"""The root group is the space itself, so the first version does not list it as an added page."""
	return [
		change
		for change in changes
		if change["change_type"] != "added" or head_items[change["doc_key"]].get("parent_key")
	]


def _page_changes(before: dict[str, Any] | None, after: dict[str, Any]) -> list[str]:
	existed = bool(before and before["title"] is not None and not before["is_deleted"])
	exists = after["title"] is not None and not after["is_deleted"]
	if not existed:
		return ["added"] if exists else []
	if not exists:
		return ["deleted"]

	changes = []
	if before["title"] != after["title"]:
		changes.append("renamed")
	elif before["route"] != after["route"]:
		changes.append("moved")
	if before["content_blob"] != after["content_blob"]:
		changes.append("edited")
	if before["is_published"] != after["is_published"]:
		changes.append("published" if after["is_published"] else "unpublished")
	return changes


def _paginate(versions: list[dict[str, Any]], start: int, limit: int) -> dict[str, Any]:
	start, limit = cint(start), cint(limit) or 50
	return {"versions": versions[start : start + limit], "more": len(versions) > start + limit}
