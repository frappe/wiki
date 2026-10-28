# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from typing import Any

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import cint, now_datetime
from frappe.website.utils import cleanup_page_name

# Wiki Document fields a revision snapshots. Changes to any other field leave revisions untouched.
REVISION_FIELDS = (
	"title",
	"slug",
	"route",
	"is_group",
	"is_tab",
	"tab_icon",
	"is_published",
	"is_external_link",
	"external_url",
	"parent_wiki_document",
	"sort_order",
	"content",
)

ITEM_FIELDS = (
	"doc_key",
	"title",
	"slug",
	"route",
	"is_group",
	"is_tab",
	"tab_icon",
	"is_published",
	"is_external_link",
	"external_url",
	"parent_key",
	"order_index",
	"content_blob",
	"is_deleted",
)
INT_ITEM_FIELDS = {"is_group", "is_tab", "is_published", "is_external_link", "order_index", "is_deleted"}


class WikiRevision(Document):
	pass


def on_doctype_update():
	# Version history reads a space's main chain in time order.
	frappe.db.add_index("Wiki Revision", ["wiki_space", "created_at"])


def create_revision_from_live_tree(
	wiki_space: str,
	message: str | None = None,
	change_request: str | None = None,
	parent_revision: str | None = None,
	is_working: int = 0,
	is_merge: int = 0,
) -> Document:
	space = frappe.get_doc("Wiki Space", wiki_space)
	root = frappe.get_doc("Wiki Document", space.root_group)

	docs = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key", *REVISION_FIELDS, "lft", "rgt"],
		filters={"lft": (">=", root.lft), "rgt": ("<=", root.rgt)},
		order_by="lft asc",
	)

	for doc in docs:
		if not doc.get("doc_key"):
			doc["doc_key"] = frappe.generate_hash(length=12)
			frappe.db.set_value(
				"Wiki Document",
				doc["name"],
				"doc_key",
				doc["doc_key"],
				update_modified=False,
			)

	name_to_key = {doc["name"]: doc["doc_key"] for doc in docs}
	blobs = get_or_create_content_blobs(doc.get("content") or "" for doc in docs)
	items = {
		doc["doc_key"]: {
			**doc,
			"slug": doc.get("slug") or cleanup_page_name(doc.get("title") or ""),
			"parent_key": name_to_key.get(doc.get("parent_wiki_document")),
			"order_index": doc.get("sort_order"),
			"content_blob": blobs[doc.get("content") or ""],
			"is_deleted": 0,
		}
		for doc in docs
	}
	return create_revision(
		wiki_space,
		items,
		parent_revision,
		message=message or "",
		change_request=change_request,
		is_working=1 if is_working else 0,
		is_merge=1 if is_merge else 0,
	)


def create_revision(
	wiki_space: str,
	items: dict[str, dict[str, Any]],
	parent_revision: str | None = None,
	**fields: Any,
) -> Document:
	"""Save `items` as a new revision: only what differs from `parent_revision`, or in full at a checkpoint."""
	items = {key: _item_row(item) for key, item in items.items()}
	rows = list(items.values())
	is_overlay = 0
	if parent_revision:
		delta = revision_delta(get_revision_item_map(parent_revision), items)
		if not _needs_checkpoint(parent_revision, len(items), len(delta)):
			rows, is_overlay = delta, 1

	revision = frappe.new_doc("Wiki Revision")
	revision.update(
		{
			"wiki_space": wiki_space,
			"parent_revision": parent_revision,
			"is_overlay": is_overlay,
			"created_by": frappe.session.user,
			"created_at": now_datetime(),
			**fields,
		}
	)
	revision.insert(ignore_permissions=True)
	insert_revision_items(revision.name, rows)
	recompute_revision_hashes(revision.name)
	return revision


def revision_delta(
	parent_items: dict[str, dict[str, Any]], items: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
	"""The rows that turn `parent_items` into `items`: changed and added pages, and a tombstone per removed page."""
	return [
		items[key] if key in items else {**parent_items[key], "is_deleted": 1}
		for key in changed_doc_keys(parent_items, items)
	]


def changed_doc_keys(
	base_items: dict[str, dict[str, Any]], other_items: dict[str, dict[str, Any]]
) -> set[str]:
	"""The doc_keys whose tree fields or content blob differ between two item maps."""
	compare_fields = [field for field in ITEM_FIELDS if field != "doc_key"]
	return {
		key
		for key in set(base_items) | set(other_items)
		if key not in base_items
		or key not in other_items
		or any(base_items[key].get(field) != other_items[key].get(field) for field in compare_fields)
	}


def _needs_checkpoint(parent_revision: str, page_count: int, delta_rows: int) -> bool:
	"""Write in full once the chain's overlay rows would reach the page count, so a read loads at most about two snapshots."""
	overlays = [revision.name for revision in _revision_chain(parent_revision) if revision.is_overlay]
	stored = frappe.db.count("Wiki Revision Item", {"revision": ("in", overlays)}) if overlays else 0
	return stored + delta_rows >= page_count


def create_overlay_revision(
	base_revision: str,
	change_request: str | None = None,
	is_working: int = 0,
) -> Document:
	"""Create an empty overlay revision that inherits items from base_revision."""
	base = frappe.get_doc("Wiki Revision", base_revision)
	revision = frappe.new_doc("Wiki Revision")
	revision.wiki_space = base.wiki_space
	revision.change_request = change_request
	revision.parent_revision = base_revision
	revision.message = base.message
	revision.is_merge = 0
	revision.is_working = 1 if is_working else 0
	revision.is_overlay = 1
	revision.hashes_stale = 0
	revision.created_by = frappe.session.user
	revision.created_at = now_datetime()
	revision.tree_hash = base.tree_hash
	revision.content_hash = base.content_hash
	revision.doc_count = base.doc_count
	revision.insert(ignore_permissions=True)
	return revision


def insert_revision_items(revision: str, items: Iterable[dict[str, Any]]) -> None:
	"""Write a revision's items in bulk. The values come from other revisions or live pages, so per-row link checks add nothing."""
	now = now_datetime()
	user = frappe.session.user
	frappe.db.bulk_insert(
		"Wiki Revision Item",
		["name", "creation", "modified", "owner", "modified_by", "revision", *ITEM_FIELDS],
		(
			(
				make_autoname("hash", "Wiki Revision Item"),
				now,
				now,
				user,
				user,
				revision,
				*(
					cint(item.get(field)) if field in INT_ITEM_FIELDS else item.get(field)
					for field in ITEM_FIELDS
				),
			)
			for item in items
		),
	)


def get_or_create_content_blobs(contents: Iterable[str], content_type: str = "markdown") -> dict[str, str]:
	"""Map each content to its blob name, with one query for the existing blobs and one insert for the rest."""
	by_hash = {hashlib.sha256(content.encode("utf-8")).hexdigest(): content for content in contents}
	if not by_hash:
		return {}
	existing = dict(
		frappe.get_all(
			"Wiki Content Blob",
			filters={"hash": ("in", list(by_hash))},
			fields=["hash", "name"],
			as_list=True,
		)
	)
	now = now_datetime()
	user = frappe.session.user
	rows = []
	for hash_value, content in by_hash.items():
		if hash_value in existing:
			continue
		existing[hash_value] = make_autoname("hash", "Wiki Content Blob")
		size = len(content.encode("utf-8"))
		rows.append(
			(existing[hash_value], now, now, user, user, hash_value, content, content_type, size, user, now)
		)
	frappe.db.bulk_insert(
		"Wiki Content Blob",
		[
			"name",
			"creation",
			"modified",
			"owner",
			"modified_by",
			"hash",
			"content",
			"content_type",
			"size",
			"created_by",
			"created_at",
		],
		rows,
	)
	return {content: existing[hash_value] for hash_value, content in by_hash.items()}


def get_or_create_content_blob(content: str, content_type: str = "markdown") -> str:
	content = content or ""
	hash_value = hashlib.sha256(content.encode("utf-8")).hexdigest()
	existing = frappe.db.get_value("Wiki Content Blob", {"hash": hash_value}, "name")
	if existing:
		return existing

	blob = frappe.new_doc("Wiki Content Blob")
	blob.hash = hash_value
	blob.content = content
	blob.content_type = content_type
	blob.size = len(content.encode("utf-8"))
	blob.created_by = frappe.session.user
	blob.created_at = now_datetime()
	blob.insert(ignore_permissions=True)
	return blob.name


def recompute_revision_hashes(revision: str) -> None:
	items = list(get_revision_item_map(revision).values())

	tree_parts = []
	content_parts = []
	for item in sorted(items, key=lambda x: x.get("doc_key") or ""):
		if item.get("is_deleted"):
			continue
		tree_parts.append(
			"|".join(
				[
					item.get("doc_key") or "",
					item.get("parent_key") or "",
					str(item.get("order_index") or 0),
					item.get("slug") or "",
					item.get("title") or "",
					item.get("route") or "",
					str(int(item.get("is_group") or 0)),
					str(int(item.get("is_published") or 0)),
					str(int(item.get("is_external_link") or 0)),
					item.get("external_url") or "",
					str(int(item.get("is_tab") or 0)),
					item.get("tab_icon") or "",
				]
			)
		)
		content_parts.append(f"{item.get('doc_key') or ''}:{item.get('content_hash') or ''}")

	tree_hash = hashlib.sha256("\n".join(tree_parts).encode("utf-8")).hexdigest()
	content_hash = hashlib.sha256("\n".join(content_parts).encode("utf-8")).hexdigest()

	update_fields = {
		"tree_hash": tree_hash,
		"content_hash": content_hash,
		"doc_count": len([item for item in items if not item.get("is_deleted")]),
		"hashes_stale": 0,
	}

	frappe.db.set_value("Wiki Revision", revision, update_fields)


def get_revision_item_map(revision: str) -> dict[str, dict[str, Any]]:
	"""The pages a revision stands for, by doc_key, with an overlay's items laid over its parent's."""
	chain = _revision_chain(revision)
	if not chain:
		return {}
	rows = frappe.get_all(
		"Wiki Revision Item",
		fields=["name", "revision", *ITEM_FIELDS, "modified"],
		filters={"revision": ("in", [link.name for link in chain])},
	)
	item_map = _lay_over(chain, rows)

	blob_names = {item["content_blob"] for item in item_map.values() if item.get("content_blob")}
	blob_hashes = {}
	if blob_names:
		blob_hashes = dict(
			frappe.get_all(
				"Wiki Content Blob",
				fields=["name", "hash"],
				filters={"name": ("in", list(blob_names))},
				as_list=True,
			)
		)
	for item in item_map.values():
		item["content_hash"] = blob_hashes.get(item.get("content_blob"))
	return item_map


def get_revision_item(revision: str, doc_key: str) -> dict[str, Any] | None:
	"""One page of a revision, read through its overlays like `get_revision_item_map`."""
	chain = _revision_chain(revision)
	if not chain:
		return None
	rows = frappe.get_all(
		"Wiki Revision Item",
		fields=["name", "revision", *ITEM_FIELDS],
		filters={"revision": ("in", [link.name for link in chain]), "doc_key": doc_key},
	)
	return _lay_over(chain, rows).get(doc_key)


def ensure_overlay_item(revision: str, doc_key: str) -> str | None:
	"""Copy-on-write: ensure doc_key has an item in the overlay revision.

	If the item already exists in the overlay, return its name.
	If the revision is an overlay and the item exists in the base, copy it.
	Returns the item name, or None if the item doesn't exist anywhere.
	"""
	existing = frappe.db.get_value("Wiki Revision Item", {"revision": revision, "doc_key": doc_key}, "name")
	if existing:
		return existing

	rev_info = frappe.db.get_value("Wiki Revision", revision, ["is_overlay", "parent_revision"], as_dict=True)
	if not (rev_info and rev_info.is_overlay and rev_info.parent_revision):
		return None

	base_item = get_revision_item(rev_info.parent_revision, doc_key)
	if not base_item:
		return None

	new_item = frappe.new_doc("Wiki Revision Item")
	new_item.update({field: base_item.get(field) for field in ITEM_FIELDS})
	new_item.revision = revision
	new_item.insert(ignore_permissions=True)
	return new_item.name


def mark_hashes_stale(revision: str) -> None:
	"""Mark a revision's hashes as needing recomputation."""
	frappe.db.set_value("Wiki Revision", revision, "hashes_stale", 1)


def ensure_revision_hashes(revision: str) -> None:
	"""Recompute hashes if they are stale."""
	if not revision:
		return
	is_stale = frappe.db.get_value("Wiki Revision", revision, "hashes_stale")
	if is_stale:
		recompute_revision_hashes(revision)


def build_tree_order(items: dict[str, dict[str, Any]]) -> list[str]:
	children: dict[str | None, list[str]] = {}
	for key, item in items.items():
		parent = item.get("parent_key")
		children.setdefault(parent, []).append(key)

	for key in list(children.keys()):
		children[key].sort(key=lambda k: items[k].get("order_index") or 0)

	ordered: list[str] = []

	def walk(parent: str | None):
		for child in children.get(parent, []):
			ordered.append(child)
			walk(child)

	walk(None)
	return ordered


def _item_row(item: dict[str, Any]) -> dict[str, Any]:
	return {
		field: cint(item.get(field)) if field in INT_ITEM_FIELDS else item.get(field) for field in ITEM_FIELDS
	}


def _revision_chain(revision: str) -> list[dict[str, Any]]:
	"""The revisions whose items make up `revision`, oldest first: a full revision, then each overlay on it."""
	return frappe.db.sql(
		"""
		WITH RECURSIVE chain AS (
			SELECT name, parent_revision, is_overlay, is_working, 0 AS depth
			FROM `tabWiki Revision`
			WHERE name = %(revision)s
			UNION ALL
			SELECT parent.name, parent.parent_revision, parent.is_overlay, parent.is_working, chain.depth + 1
			FROM `tabWiki Revision` parent
			JOIN chain ON parent.name = chain.parent_revision
			WHERE chain.is_overlay = 1
		)
		SELECT name, is_overlay, is_working FROM chain ORDER BY depth DESC
		""",
		{"revision": revision},
		as_dict=True,
	)


def _lay_over(chain: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
	"""Apply each revision's rows over the ones before it.

	A tombstone in a committed revision removes the page. One in a working revision
	(a change request head) stays, so the change request still lists the page as deleted.
	"""
	position = {link.name: index for index, link in enumerate(chain)}
	working = {link.name for link in chain if link.is_working}
	items: dict[str, dict[str, Any]] = {}
	for row in sorted(rows, key=lambda row: position[row.revision]):
		revision = row.pop("revision")
		if row.is_deleted and revision not in working:
			items.pop(row.doc_key, None)
		else:
			items[row.doc_key] = row
	return items
