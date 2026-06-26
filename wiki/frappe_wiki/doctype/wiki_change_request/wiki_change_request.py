# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe.website.utils import cleanup_page_name

from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
	build_tree_order,
	create_overlay_revision,
	create_revision_from_live_tree,
	ensure_overlay_item,
	ensure_revision_hashes,
	get_effective_revision_item_map,
	get_or_create_content_blob,
	get_revision_item_map,
	mark_hashes_stale,
	recompute_revision_hashes,
)


class WikiChangeRequest(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		archived_at: DF.Datetime | None
		base_revision: DF.Link
		description: DF.SmallText | None
		head_revision: DF.Link
		merge_revision: DF.Link | None
		merged_at: DF.Datetime | None
		merged_by: DF.Link | None
		operation_version: DF.Int
		outdated: DF.Check
		rejected_at: DF.Datetime | None
		review_comment: DF.SmallText | None
		reviewed_at: DF.Datetime | None
		reviewed_by: DF.Link | None
		status: DF.Literal[
			"Draft", "In Review", "Changes Requested", "Approved", "Rejected", "Merged", "Archived"
		]
		title: DF.Data
		wiki_space: DF.Link
	# end: auto-generated types

	pass


def on_doctype_update():
	# Draft lookup and change-request listings filter by (wiki_space, status);
	# see _find_existing_draft and list_change_requests below.
	frappe.db.add_index("Wiki Change Request", ["wiki_space", "status"])


@frappe.whitelist()
def get_change_request(name: str) -> dict[str, Any]:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("read")
	return cr.as_dict()


def _can_merge(wiki_space: str | None, user: str | None = None) -> bool:
	"""Whether the current user may merge Change Requests into this space.

	Managers always can; otherwise the user needs Write-level access on the
	owning Wiki Space (an open space falls back to the global Wiki Approver).
	"""
	from wiki.permissions import can_write_space

	return can_write_space(wiki_space, user)


# Statuses in which the CR head revision may still be mutated by its author.
_EDITABLE_STATUSES = {"Draft", "Changes Requested"}


def _assert_status(cr: Document, allowed: set[str]) -> None:
	"""Guard a transition against the CR's current status."""
	if cr.status not in allowed:
		frappe.throw(
			_("This change request is {0} and cannot be changed.").format(cr.status),
			frappe.ValidationError,
		)


def _assert_editable(cr: Document) -> None:
	"""Block any head-revision mutation once the CR has left an editable state.

	A CR is only editable while it is a `Draft` or has `Changes Requested`.
	Once it is `In Review` / `Approved` / `Merged` / `Rejected` the content is
	frozen so a reviewer never sees a moving target.
	"""
	if cr.status not in _EDITABLE_STATUSES:
		frappe.throw(
			_("This change request is {0} and is locked for editing.").format(cr.status),
			frappe.ValidationError,
		)


def _notify_cr_owner(cr: Document, subject: str) -> None:
	"""Ping the CR author about a reviewer decision or merge.

	A realtime event (the custom frontend listens) plus a Notification Log
	entry so the signal survives a page reload. No-op when the actor is the
	author — a self-serve approve & merge shouldn't notify yourself. The
	Notification Log write is best-effort: a notification hiccup must never
	roll back the decision it accompanies.
	"""
	if cr.owner == frappe.session.user:
		return

	frappe.publish_realtime(
		"wiki_change_request_update",
		{"name": cr.name, "status": cr.status, "subject": subject},
		user=cr.owner,
		after_commit=True,
	)

	try:
		notification = frappe.new_doc("Notification Log")
		notification.for_user = cr.owner
		notification.from_user = frappe.session.user
		notification.type = "Alert"
		notification.document_type = "Wiki Change Request"
		notification.document_name = cr.name
		notification.subject = subject
		notification.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error("Failed to create Wiki Change Request notification")


def touch_change_request(name: str) -> None:
	frappe.db.set_value(
		"Wiki Change Request",
		name,
		{"modified": now_datetime(), "modified_by": frappe.session.user},
		update_modified=False,
	)


def _bump_operation_version(cr: Document) -> int:
	"""Increment `operation_version` once per logical mutation.

	Called by both the batch endpoint and every legacy mutating RPC so the
	version is a true monotonic counter for any write to the CR head
	revision. Without this, a legacy client (or `useBatchOperations = false`
	on the frontend) could change state without bumping the version, and a
	subsequent batch with a stale `base_version` would still be accepted —
	silently overwriting the legacy write.

	The caller must hold a row lock on this CR via `_lock_and_load_cr`,
	otherwise two concurrent writers can both read the same in-memory
	`cr.operation_version`, compute the same `+1`, and silently merge.
	"""
	new_version = int(cr.operation_version or 0) + 1
	frappe.db.set_value("Wiki Change Request", cr.name, "operation_version", new_version)
	cr.operation_version = new_version
	return new_version


def _lock_and_load_cr(name: str) -> Document:
	"""Load a Change Request and acquire a row-level lock on `operation_version`.

	Every mutating endpoint (batch + legacy RPCs) must load CRs through
	this so concurrent writers serialize at the row level. The lock is
	held until the request transaction commits/rollbacks; without it, two
	in-flight writers can both read the same base version, both pass the
	conflict check, and both `_bump_operation_version` to the same value
	— leaving the counter advanced by 1 instead of 2 and merging two
	clients' state against the same base.
	"""
	locked = frappe.db.get_value("Wiki Change Request", name, "operation_version", for_update=True)
	cr = frappe.get_doc("Wiki Change Request", name)
	# Keep the in-memory view consistent with the locked DB value so
	# `_bump_operation_version` computes from the right base.
	cr.operation_version = int(locked or 0)
	return cr


# --- Internal CR mutation helpers ---------------------------------------------------
#
# These are the single source of truth for mutating items in a CR head revision.
# Both the legacy per-action RPCs and the batch `apply_cr_operations` endpoint go
# through them. Helpers do NOT call `mark_hashes_stale` or `touch_change_request` —
# the caller invokes those once after a logical unit of work so a batch only pays
# that cost a single time.

_CR_ITEM_SCALAR_UPDATE_FIELDS = ("title", "slug", "route", "external_url")
_CR_ITEM_CHECKBOX_UPDATE_FIELDS = ("is_group", "is_published", "is_external_link", "is_deleted")


def _compute_cr_route(
	cr: Document, parent_key: str | None, slug: str, item_map: dict[str, dict[str, Any]]
) -> str:
	"""Build a route from the wiki space root + ancestor slugs + the item slug.

	The root group's slug is intentionally skipped — the wiki space route already
	covers it.
	"""
	route_parts = [slug]
	current_parent = parent_key
	while current_parent and current_parent in item_map:
		ancestor = item_map[current_parent]
		if not ancestor.get("parent_key"):
			break
		route_parts.insert(0, ancestor.get("slug") or "")
		current_parent = ancestor.get("parent_key")
	space_route = frappe.db.get_value("Wiki Space", cr.wiki_space, "route") or ""
	if space_route:
		route_parts.insert(0, space_route)
	return "/".join(route_parts)


def _serialize_cr_item(cr: Document, doc_key: str, include_content: bool = False) -> dict[str, Any] | None:
	"""Return the canonical CR item payload, or None if the item is missing/deleted.

	Mirrors the shape of `get_cr_page` so the frontend can merge batch responses
	into the same store slots it already populates from individual reads.
	"""
	_item_fields = [
		"doc_key",
		"title",
		"slug",
		"route",
		"is_group",
		"is_published",
		"is_external_link",
		"external_url",
		"parent_key",
		"order_index",
		"content_blob",
		"is_deleted",
	]
	item = frappe.db.get_value(
		"Wiki Revision Item",
		{"revision": cr.head_revision, "doc_key": doc_key},
		_item_fields,
		as_dict=True,
	)
	if not item:
		rev_info = frappe.db.get_value(
			"Wiki Revision", cr.head_revision, ["is_overlay", "parent_revision"], as_dict=True
		)
		if rev_info and rev_info.is_overlay and rev_info.parent_revision:
			item = frappe.db.get_value(
				"Wiki Revision Item",
				{"revision": rev_info.parent_revision, "doc_key": doc_key},
				_item_fields,
				as_dict=True,
			)
	if not item or item.get("is_deleted"):
		return None

	payload: dict[str, Any] = {
		"doc_key": item.get("doc_key"),
		"title": item.get("title"),
		"slug": item.get("slug"),
		"route": item.get("route") or "",
		"is_group": item.get("is_group"),
		"is_published": item.get("is_published"),
		"is_external_link": item.get("is_external_link"),
		"external_url": item.get("external_url"),
		"parent_key": item.get("parent_key"),
		"order_index": item.get("order_index"),
		"document_name": frappe.db.get_value("Wiki Document", {"doc_key": doc_key}, "name") or None,
	}
	if include_content:
		content = ""
		if item.get("content_blob"):
			content = frappe.get_value("Wiki Content Blob", item.get("content_blob"), "content") or ""
		payload["content"] = content
	return payload


def _create_cr_item(
	cr: Document,
	*,
	parent_key: str | None,
	title: str,
	slug: str | None = None,
	is_group: bool = False,
	is_published: bool = True,
	content: str = "",
	is_external_link: bool = False,
	external_url: str | None = None,
	order_index: int | None = None,
	route: str | None = None,
) -> str:
	head_revision = cr.head_revision
	item_map = get_effective_revision_item_map(head_revision)
	max_order = max(
		[it.get("order_index") or 0 for it in item_map.values() if it.get("parent_key") == parent_key] or [0]
	)

	item = frappe.new_doc("Wiki Revision Item")
	item.revision = head_revision
	item.doc_key = frappe.generate_hash(length=12)
	item.title = title
	item.slug = slug or cleanup_page_name(title)
	item.is_group = 1 if is_group else 0
	item.is_published = 1 if is_published else 0
	item.is_external_link = 1 if is_external_link else 0
	item.external_url = external_url
	item.parent_key = parent_key
	item.order_index = order_index if order_index is not None else max_order + 1
	item.content_blob = get_or_create_content_blob(content or "")
	item.is_deleted = 0
	item.route = route if route is not None else _compute_cr_route(cr, parent_key, item.slug, item_map)
	item.insert()
	return item.doc_key


def _update_cr_item(
	cr: Document,
	doc_key: str,
	fields: dict[str, Any],
	*,
	recompute_route: bool = False,
) -> str:
	item_name = ensure_overlay_item(cr.head_revision, doc_key)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	updates = {
		field: fields[field] for field in _CR_ITEM_SCALAR_UPDATE_FIELDS if fields.get(field) is not None
	}
	updates.update(
		{
			field: int(bool(fields[field]))
			for field in _CR_ITEM_CHECKBOX_UPDATE_FIELDS
			if fields.get(field) is not None
		}
	)
	if fields.get("content") is not None:
		updates["content_blob"] = get_or_create_content_blob(fields["content"])
	item.update(updates)

	# When the caller (typically the batch endpoint) didn't pin a route but title
	# or slug changed, recompute it so renames don't leave stale routes.
	if (
		recompute_route
		and "route" not in fields
		and (
			("title" in fields and fields["title"] is not None)
			or ("slug" in fields and fields["slug"] is not None)
		)
	):
		item_map = get_effective_revision_item_map(cr.head_revision)
		item.route = _compute_cr_route(cr, item.parent_key, item.slug, item_map)

	item.save()
	return item.doc_key


def _delete_cr_item(cr: Document, doc_key: str) -> list[str]:
	item_name = ensure_overlay_item(cr.head_revision, doc_key)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	item.is_deleted = 1
	item.save()

	deleted = [doc_key]
	effective_items = get_effective_revision_item_map(cr.head_revision)
	children: dict[str | None, list[str]] = {}
	for key, item_data in effective_items.items():
		children.setdefault(item_data.get("parent_key"), []).append(key)

	to_visit = [doc_key]
	seen = {doc_key}
	while to_visit:
		current = to_visit.pop()
		for child_key in children.get(current, []):
			if child_key in seen:
				continue
			seen.add(child_key)
			child_item_name = ensure_overlay_item(cr.head_revision, child_key)
			if child_item_name:
				frappe.db.set_value("Wiki Revision Item", child_item_name, "is_deleted", 1)
				deleted.append(child_key)
			to_visit.append(child_key)
	return deleted


def _move_cr_item(
	cr: Document,
	doc_key: str,
	parent_key: str | None,
	order_index: int | None = None,
) -> str:
	item_name = ensure_overlay_item(cr.head_revision, doc_key)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	item.parent_key = parent_key
	if order_index is not None:
		item.order_index = order_index
	item.save()
	return item.doc_key


def _reorder_cr_children(cr: Document, parent_key: str | None, ordered_doc_keys: list[str]) -> list[str]:
	affected: list[str] = []
	for index, doc_key in enumerate(ordered_doc_keys):
		item_name = ensure_overlay_item(cr.head_revision, doc_key)
		if not item_name:
			continue
		actual_parent = frappe.db.get_value("Wiki Revision Item", item_name, "parent_key")
		if actual_parent != parent_key:
			continue
		frappe.db.set_value("Wiki Revision Item", item_name, "order_index", index)
		affected.append(doc_key)
	return affected


def has_revision_changes(base_revision: str | None, head_revision: str | None) -> bool:
	if not base_revision or not head_revision:
		return False
	ensure_revision_hashes(base_revision)
	ensure_revision_hashes(head_revision)
	base_hash = (
		frappe.get_value(
			"Wiki Revision",
			base_revision,
			["tree_hash", "content_hash"],
			as_dict=True,
		)
		or {}
	)
	head_hash = (
		frappe.get_value(
			"Wiki Revision",
			head_revision,
			["tree_hash", "content_hash"],
			as_dict=True,
		)
		or {}
	)
	return bool(
		base_hash.get("tree_hash") != head_hash.get("tree_hash")
		or base_hash.get("content_hash") != head_hash.get("content_hash")
	)


@frappe.whitelist()
def get_or_create_draft_change_request(wiki_space: str, title: str | None = None) -> dict[str, Any]:
	from wiki.permissions import assert_space_writable, can_read_space

	if not can_read_space(wiki_space):
		frappe.throw(_("You do not have access to this wiki space."), frappe.PermissionError)

	assert_space_writable(wiki_space)

	cr = _find_existing_draft(wiki_space)
	if cr:
		if _is_stale_empty_draft(cr, wiki_space):
			_archive_stale_draft(cr)
		else:
			return cr.as_dict()

	space = frappe.get_doc("Wiki Space", wiki_space)
	default_title = title or f"Draft Changes - {space.space_name}"
	return create_change_request(wiki_space, default_title).as_dict()


def _find_existing_draft(wiki_space: str) -> Document | None:
	"""Find user's most relevant draft: prefer one with actual changes."""
	existing = frappe.get_all(
		"Wiki Change Request",
		filters={
			"wiki_space": wiki_space,
			"status": ("in", ["Draft", "Changes Requested"]),
			"owner": frappe.session.user,
		},
		fields=["name", "base_revision", "head_revision", "modified"],
		order_by="modified desc",
	)
	if not existing:
		return None

	selected = None
	for row in existing:
		if has_revision_changes(row.get("base_revision"), row.get("head_revision")):
			selected = row
			break
	if not selected:
		selected = existing[0]

	cr = frappe.get_doc("Wiki Change Request", selected["name"])
	cr.check_permission("read")
	return cr


def _is_stale_empty_draft(cr: Document, wiki_space: str) -> bool:
	"""True if the draft is outdated AND has no changes."""
	main_revision = frappe.get_value("Wiki Space", wiki_space, "main_revision")
	if not main_revision or not cr.base_revision or cr.base_revision == main_revision:
		return False
	frappe.db.set_value("Wiki Change Request", cr.name, "outdated", 1)
	return not has_revision_changes(cr.base_revision, cr.head_revision)


def _archive_stale_draft(cr: Document) -> None:
	"""Archive a stale empty draft."""
	frappe.db.set_value(
		"Wiki Change Request",
		cr.name,
		{"status": "Archived", "archived_at": now_datetime()},
	)


@frappe.whitelist()
def list_change_requests(wiki_space: str, status: str | None = None) -> list[dict[str, Any]]:
	filters: dict[str, Any] = {"wiki_space": wiki_space}
	if status:
		filters["status"] = status
	return frappe.get_all(
		"Wiki Change Request",
		filters=filters,
		fields=[
			"name",
			"title",
			"wiki_space",
			"status",
			"description",
			"base_revision",
			"head_revision",
			"merge_revision",
			"outdated",
			"modified",
			"merged_at",
			"merged_by",
			"archived_at",
			"owner",
		],
		order_by="modified desc",
	)


@frappe.whitelist()
def update_change_request(name: str, title: str | None = None, description: str | None = None) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("write")
	if title is not None:
		cr.title = title
	if description is not None:
		cr.description = description
	cr.save()


@frappe.whitelist()
def archive_change_request(name: str) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("write")
	cr.status = "Archived"
	cr.archived_at = now_datetime()
	cr.save()


@frappe.whitelist()
def get_cr_tree(name: str) -> dict[str, Any]:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("read")

	root_group = frappe.db.get_value("Wiki Space", cr.wiki_space, "root_group")
	operation_version = int(cr.operation_version or 0)
	if not root_group:
		return {"children": [], "root_group": None, "operation_version": operation_version}

	root_key = frappe.get_value("Wiki Document", root_group, "doc_key")
	effective_items = get_effective_revision_item_map(cr.head_revision)

	doc_map: dict[str, dict[str, Any]] = {}
	for item in effective_items.values():
		if item.get("is_deleted"):
			continue
		doc_map[item["doc_key"]] = {
			"doc_key": item.get("doc_key"),
			"document_name": None,
			"route": item.get("route"),
			"title": item.get("title"),
			"slug": item.get("slug"),
			"is_group": item.get("is_group"),
			"is_published": item.get("is_published"),
			"is_external_link": item.get("is_external_link"),
			"external_url": item.get("external_url"),
			"parent_key": item.get("parent_key"),
			"order_index": item.get("order_index") or 0,
			"label": item.get("title"),
			"children": [],
		}

	for node in doc_map.values():
		parent_key = node.get("parent_key")
		if parent_key and parent_key in doc_map:
			doc_map[parent_key]["children"].append(node)

	doc_names = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key", "route"],
		filters={"doc_key": ("in", list(doc_map.keys()))},
	)
	doc_name_map = {row["doc_key"]: row for row in doc_names}
	for node in doc_map.values():
		mapped = doc_name_map.get(node["doc_key"])
		if mapped:
			node["document_name"] = mapped.get("name")
			node["route"] = mapped.get("route")

	change_map = {
		change.get("doc_key"): change.get("change_type")
		for change in (diff_change_request(cr.name, scope="summary") or [])
		if change.get("doc_key")
	}
	if change_map:
		for node in doc_map.values():
			change_type = change_map.get(node.get("doc_key"))
			if change_type:
				node["_changeType"] = change_type

	def sort_children(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
		nodes.sort(key=lambda n: (n.get("order_index") or 0, n.get("title") or ""))
		for node in nodes:
			children = node.get("children") or []
			node["children"] = sort_children(children)
		return nodes

	if root_key and root_key in doc_map:
		children = sort_children(doc_map[root_key]["children"])
	else:
		children = sort_children(
			[
				node
				for node in doc_map.values()
				if not node.get("parent_key") or node.get("parent_key") not in doc_map
			]
		)

	return {
		"children": children,
		"root_group": root_key,
		"operation_version": operation_version,
	}


@frappe.whitelist()
def get_cr_page(name: str, doc_key: str) -> dict[str, Any]:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("read")

	_item_fields = [
		"doc_key",
		"title",
		"slug",
		"route",
		"is_group",
		"is_published",
		"is_external_link",
		"external_url",
		"parent_key",
		"order_index",
		"content_blob",
		"is_deleted",
	]
	item = frappe.db.get_value(
		"Wiki Revision Item",
		{"revision": cr.head_revision, "doc_key": doc_key},
		_item_fields,
		as_dict=True,
	)
	# For overlay revisions, fall back to base if item isn't in the overlay
	if not item:
		rev_info = frappe.db.get_value(
			"Wiki Revision", cr.head_revision, ["is_overlay", "parent_revision"], as_dict=True
		)
		if rev_info and rev_info.is_overlay and rev_info.parent_revision:
			item = frappe.db.get_value(
				"Wiki Revision Item",
				{"revision": rev_info.parent_revision, "doc_key": doc_key},
				_item_fields,
				as_dict=True,
			)
	if not item or item.get("is_deleted"):
		frappe.throw(_("Document not found in change request"))

	content = ""
	if item.get("content_blob"):
		content = frappe.get_value("Wiki Content Blob", item.get("content_blob"), "content") or ""

	doc_name = frappe.db.get_value("Wiki Document", {"doc_key": doc_key}, "name")
	return {
		"doc_key": item.get("doc_key"),
		"title": item.get("title"),
		"slug": item.get("slug"),
		"route": item.get("route") or "",
		"is_group": item.get("is_group"),
		"is_published": item.get("is_published"),
		"is_external_link": item.get("is_external_link"),
		"external_url": item.get("external_url"),
		"parent_key": item.get("parent_key"),
		"order_index": item.get("order_index"),
		"document_name": doc_name or None,
		"content": content,
	}


@frappe.whitelist()
def create_change_request(wiki_space: str, title: str, description: str | None = None) -> Document:
	from wiki.permissions import assert_space_writable, can_read_space

	if not can_read_space(wiki_space):
		frappe.throw(_("You do not have access to this wiki space."), frappe.PermissionError)

	assert_space_writable(wiki_space)

	space = frappe.get_doc("Wiki Space", wiki_space)
	if not space.main_revision:
		# Seed the first revision with elevated privileges so a Read-tier
		# contributor (allowed to raise CRs) can bootstrap a fresh space.
		main_revision = _bootstrap_main_revision(wiki_space)
		frappe.db.set_value("Wiki Space", wiki_space, "main_revision", main_revision.name)
		space.main_revision = main_revision.name

	base_revision = space.main_revision
	head_revision = create_overlay_revision(base_revision, is_working=1)

	cr = frappe.new_doc("Wiki Change Request")
	cr.title = title
	cr.wiki_space = wiki_space
	cr.status = "Draft"
	cr.description = description
	cr.base_revision = base_revision
	cr.head_revision = head_revision.name
	cr.insert()

	frappe.db.set_value("Wiki Revision", head_revision.name, "change_request", cr.name)
	return cr


def _bootstrap_main_revision(wiki_space: str) -> Document:
	"""Create a fresh space's initial main revision with elevated privileges.

	The revision-creation path inserts Wiki Revision / Wiki Revision Item docs
	that a plain Wiki User can't create. The caller has already verified the
	user can *read* the space (Phase 4 read gate), so we seed the first revision
	with `ignore_permissions` — keeping the real `created_by` and the current
	session intact (no `set_user`).
	"""
	return create_revision_from_live_tree(wiki_space, message="Initial main", ignore_permissions=True)


@frappe.whitelist()
def create_cr_page(
	name: str,
	parent_key: str,
	title: str,
	slug: str | None = None,
	is_group: int = 0,
	is_published: int = 1,
	content: str | None = None,
	order_index: int | None = None,
	is_external_link: int = 0,
	external_url: str | None = None,
) -> str:
	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)
	new_key = _create_cr_item(
		cr,
		parent_key=parent_key,
		title=title,
		slug=slug,
		is_group=bool(is_group),
		is_published=bool(is_published),
		content=content or "",
		is_external_link=bool(is_external_link),
		external_url=external_url,
		order_index=order_index,
	)
	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)
	_bump_operation_version(cr)
	return new_key


@frappe.whitelist()
def update_cr_page(name: str, doc_key: str, fields: dict[str, Any]) -> None:
	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)
	_update_cr_item(cr, doc_key, fields)
	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)
	_bump_operation_version(cr)


@frappe.whitelist()
def move_cr_page(name: str, doc_key: str, new_parent_key: str, new_order_index: int | None = None) -> None:
	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)
	_move_cr_item(cr, doc_key, new_parent_key, order_index=new_order_index)
	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)
	_bump_operation_version(cr)


@frappe.whitelist()
def reorder_cr_children(name: str, parent_key: str, ordered_doc_keys: list[str]) -> None:
	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)
	_reorder_cr_children(cr, parent_key, ordered_doc_keys)
	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)
	_bump_operation_version(cr)


@frappe.whitelist()
def delete_cr_page(name: str, doc_key: str) -> None:
	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)
	_delete_cr_item(cr, doc_key)
	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)
	_bump_operation_version(cr)


# --- Batch operation endpoint -------------------------------------------------------


def _resolve_temp_key(key: str | None, temp_key_map: dict[str, str]) -> str | None:
	if key is None:
		return None
	return temp_key_map.get(key, key)


def _apply_operation(
	*,
	cr: Document,
	op: dict[str, Any],
	temp_key_map: dict[str, str],
	affected_doc_keys: set[str],
	deleted_doc_keys: set[str],
	content_doc_keys: set[str],
) -> None:
	op_type = op.get("type")

	if op_type == "create_node":
		temp_key = op.get("temp_key")
		if not temp_key:
			frappe.throw(_("create_node operation requires temp_key"))
		title = op.get("title")
		if title is None:
			frappe.throw(_("create_node operation requires title"))
		new_key = _create_cr_item(
			cr,
			parent_key=_resolve_temp_key(op.get("parent_key"), temp_key_map),
			title=title,
			slug=op.get("slug"),
			is_group=bool(op.get("is_group")),
			is_published=bool(op.get("is_published", True)),
			content=op.get("content") or "",
			is_external_link=bool(op.get("is_external_link")),
			external_url=op.get("external_url"),
			order_index=op.get("order_index"),
			route=op.get("route"),
		)
		temp_key_map[temp_key] = new_key
		affected_doc_keys.add(new_key)
		if op.get("content") is not None:
			content_doc_keys.add(new_key)
		return

	if op_type == "update_node":
		doc_key = _resolve_temp_key(op.get("doc_key"), temp_key_map)
		if not doc_key:
			frappe.throw(_("update_node operation requires doc_key"))
		fields = op.get("fields") or {}
		_update_cr_item(cr, doc_key, fields, recompute_route=True)
		affected_doc_keys.add(doc_key)
		return

	if op_type == "update_content":
		doc_key = _resolve_temp_key(op.get("doc_key"), temp_key_map)
		if not doc_key:
			frappe.throw(_("update_content operation requires doc_key"))
		if "content" not in op:
			frappe.throw(_("update_content operation requires content"))
		fields: dict[str, Any] = {"content": op.get("content")}
		if op.get("title") is not None:
			fields["title"] = op["title"]
		_update_cr_item(cr, doc_key, fields)
		affected_doc_keys.add(doc_key)
		content_doc_keys.add(doc_key)
		return

	if op_type == "delete_node":
		doc_key = _resolve_temp_key(op.get("doc_key"), temp_key_map)
		if not doc_key:
			frappe.throw(_("delete_node operation requires doc_key"))
		deleted = _delete_cr_item(cr, doc_key)
		deleted_doc_keys.update(deleted)
		return

	if op_type == "move_node":
		doc_key = _resolve_temp_key(op.get("doc_key"), temp_key_map)
		if not doc_key:
			frappe.throw(_("move_node operation requires doc_key"))
		target_parent = _resolve_temp_key(op.get("target_parent_key"), temp_key_map)
		_move_cr_item(cr, doc_key, target_parent, order_index=op.get("order_index"))
		affected_doc_keys.add(doc_key)
		return

	if op_type == "reorder_children":
		parent_key = _resolve_temp_key(op.get("parent_key"), temp_key_map)
		ordered = [_resolve_temp_key(k, temp_key_map) for k in (op.get("ordered_doc_keys") or [])]
		ordered = [k for k in ordered if k is not None]
		affected = _reorder_cr_children(cr, parent_key, ordered)
		affected_doc_keys.update(affected)
		return

	frappe.throw(_("Unknown operation type: {0}").format(op_type))


@frappe.whitelist()
def apply_cr_operations(
	name: str,
	base_version: int | str | None = None,
	operations: list[dict[str, Any]] | str | None = None,
) -> dict[str, Any]:
	"""Apply an ordered batch of operations to a Change Request head revision.

	The whole batch lives inside Frappe's request transaction, so any failure rolls
	back every preceding operation. Temp keys created in earlier operations are
	resolved for later operations in the same batch via `temp_key_map`.
	"""
	if isinstance(operations, str):
		operations = frappe.parse_json(operations)
	if not isinstance(operations, list) or not operations:
		frappe.throw(_("operations must be a non-empty list"))

	cr = _lock_and_load_cr(name)
	cr.check_permission("write")
	_assert_editable(cr)

	from wiki.permissions import assert_space_writable

	assert_space_writable(cr.wiki_space)

	current_version = int(cr.operation_version or 0)
	if base_version is not None:
		try:
			client_version = int(base_version)
		except (TypeError, ValueError):
			frappe.throw(_("base_version must be an integer"))
		# Only flag a conflict when the client is behind. If the client is somehow
		# ahead (e.g. it cached a future value), we still apply — the server is
		# the source of truth and will hand back the new version.
		if client_version < current_version:
			return {
				"ok": False,
				"error": "version_conflict",
				"current_version": current_version,
				"message": _("This draft has changed elsewhere. Reload latest."),
			}

	temp_key_map: dict[str, str] = {}
	affected_doc_keys: set[str] = set()
	deleted_doc_keys: set[str] = set()
	content_doc_keys: set[str] = set()
	by_type: dict[str, int] = {}

	for op in operations:
		if not isinstance(op, dict):
			frappe.throw(_("Each operation must be an object"))
		op_type = op.get("type")
		if not op_type:
			frappe.throw(_("Operation is missing 'type'"))
		by_type[op_type] = by_type.get(op_type, 0) + 1
		_apply_operation(
			cr=cr,
			op=op,
			temp_key_map=temp_key_map,
			affected_doc_keys=affected_doc_keys,
			deleted_doc_keys=deleted_doc_keys,
			content_doc_keys=content_doc_keys,
		)

	# An item that was created or touched and then deleted in the same batch
	# belongs only in deleted_doc_keys, not in items[].
	affected_doc_keys -= deleted_doc_keys

	mark_hashes_stale(cr.head_revision)
	touch_change_request(cr.name)

	new_version = _bump_operation_version(cr)

	items: list[dict[str, Any]] = []
	for dk in affected_doc_keys:
		payload = _serialize_cr_item(cr, dk, include_content=(dk in content_doc_keys))
		if payload:
			items.append(payload)

	return {
		"ok": True,
		"current_version": new_version,
		"temp_key_map": temp_key_map,
		"items": items,
		"deleted_doc_keys": list(deleted_doc_keys),
		"change_summary": {"count": len(operations), "by_type": by_type},
	}


def _node_location(item_map: dict[str, dict[str, Any]], doc_key: str) -> dict[str, Any] | None:
	"""Ancestor-title path and 1-based sibling position for a node.

	Used to render a reorder as "where it sat" → "where it sits now" rather than
	a meaningless content diff. Returns `None` if the node isn't in this map.
	"""
	item = item_map.get(doc_key)
	if not item:
		return None

	# Walk parent links up to the root, collecting ancestor titles. The space's
	# root group (the top-level node with no parent of its own) is structural, not
	# a real breadcrumb segment, so it is left out.
	titles: list[str] = []
	seen: set[str] = set()
	cursor = item
	while cursor.get("parent_key") and cursor["parent_key"] not in seen:
		seen.add(cursor.get("doc_key"))
		parent = item_map.get(cursor["parent_key"])
		if not parent or not parent.get("parent_key"):
			break
		titles.append(parent.get("title") or _("Untitled"))
		cursor = parent
	titles.reverse()

	# Rank among non-deleted siblings sharing the same parent, ordered as shown.
	siblings = [
		it
		for it in item_map.values()
		if it.get("parent_key") == item.get("parent_key") and not it.get("is_deleted")
	]
	siblings.sort(key=lambda it: it.get("order_index") if it.get("order_index") is not None else 0)
	position = next(
		(idx + 1 for idx, it in enumerate(siblings) if it.get("doc_key") == doc_key),
		None,
	)

	return {"path": titles, "position": position, "total": len(siblings)}


def _sibling_position_map(item_map: dict[str, dict[str, Any]]) -> dict[str, int]:
	"""1-based position of each non-deleted node among its siblings.

	Lets reorder detection compare *actual position* rather than the raw
	`order_index` integer, which gets renumbered for every sibling whenever any
	one of them moves — flagging untouched pages as "reordered" by accident.
	"""
	by_parent: dict[str | None, list[tuple[str, int]]] = {}
	for key, item in item_map.items():
		if item.get("is_deleted"):
			continue
		order = item.get("order_index") if item.get("order_index") is not None else 0
		by_parent.setdefault(item.get("parent_key"), []).append((key, order))

	positions: dict[str, int] = {}
	for siblings in by_parent.values():
		siblings.sort(key=lambda pair: pair[1])
		for index, (key, _order) in enumerate(siblings):
			positions[key] = index + 1
	return positions


@frappe.whitelist()
def diff_change_request(name: str, scope: str = "summary", doc_key: str | None = None):
	cr = frappe.get_doc("Wiki Change Request", name)
	base_items = get_revision_item_map(cr.base_revision)
	head_items = get_effective_revision_item_map(cr.head_revision)
	base_contents: dict[str, str] = {}
	head_contents: dict[str, str] = {}

	def normalize(item: dict[str, Any] | None, content: str | None = None) -> dict[str, Any] | None:
		if not item or item.get("is_deleted"):
			return None
		result = {
			"title": item.get("title"),
			"slug": item.get("slug"),
			"route": item.get("route"),
			"is_group": item.get("is_group"),
			"is_published": item.get("is_published"),
			"is_external_link": item.get("is_external_link"),
			"external_url": item.get("external_url"),
			"parent_key": item.get("parent_key"),
			"order_index": item.get("order_index"),
			"content_hash": item.get("content_hash"),
		}
		if content is not None:
			result["content"] = content
		return result

	if scope == "page" and doc_key:
		if doc_key in base_items:
			base_contents = get_contents_for_items({doc_key: base_items.get(doc_key)})
		if doc_key in head_items:
			head_contents = get_contents_for_items({doc_key: head_items.get(doc_key)})
		base = normalize(base_items.get(doc_key), base_contents.get(doc_key, ""))
		head = normalize(head_items.get(doc_key), head_contents.get(doc_key, ""))
		# Location (ancestor path + sibling position) so a pure reorder can be
		# shown as a structural before/after instead of an empty content diff.
		location = {
			"base": _node_location(base_items, doc_key),
			"head": _node_location(head_items, doc_key),
		}
		return {"doc_key": doc_key, "base": base, "head": head, "location": location}

	changes = []
	base_positions = _sibling_position_map(base_items)
	head_positions = _sibling_position_map(head_items)
	all_keys = set(base_items) | set(head_items)
	for key in all_keys:
		base = normalize(base_items.get(key))
		head = normalize(head_items.get(key))
		head_item = head_items.get(key) or {}
		base_item = base_items.get(key) or {}
		# Use modified timestamp from head revision item for ordering
		modified = head_item.get("modified") or base_item.get("modified")
		if base is None and head is None:
			continue
		if base is None and head is not None:
			changes.append(
				{
					"doc_key": key,
					"change_type": "added",
					"title": head.get("title"),
					"is_group": head.get("is_group"),
					"is_external_link": head.get("is_external_link"),
					"external_url": head.get("external_url"),
					"_modified": modified,
				}
			)
			continue
		if base is not None and head is None:
			changes.append(
				{
					"doc_key": key,
					"change_type": "deleted",
					"title": base.get("title"),
					"is_group": base.get("is_group"),
					"is_external_link": base.get("is_external_link"),
					"external_url": base.get("external_url"),
					"_modified": modified,
				}
			)
			continue
		if base != head:
			change_type = "modified"
			metadata_fields = ["title", "slug", "route", "is_group", "is_published", "parent_key"]
			metadata_changed = any(base.get(field) != head.get(field) for field in metadata_fields)
			content_changed = base.get("content_hash") != head.get("content_hash")
			if base.get("content_hash") is None and head.get("content_hash") is None:
				base_blob = (base_items.get(key) or {}).get("content_blob")
				head_blob = (head_items.get(key) or {}).get("content_blob")
				content_changed = base_blob != head_blob
			# Compare actual sibling position, not the raw order_index: a reorder
			# renumbers every sibling, so order_index alone falsely flags pages
			# that never moved.
			position_changed = base_positions.get(key) != head_positions.get(key)
			if not metadata_changed and not content_changed:
				# Order-index churn with no real position change is noise — skip it.
				if not position_changed:
					continue
				change_type = "reordered"
			changes.append(
				{
					"doc_key": key,
					"change_type": change_type,
					"title": head.get("title") or base.get("title"),
					"is_group": head.get("is_group")
					if head.get("is_group") is not None
					else base.get("is_group"),
					"is_external_link": head.get("is_external_link")
					if head.get("is_external_link") is not None
					else base.get("is_external_link"),
					"external_url": head.get("external_url") or base.get("external_url"),
					"_modified": modified,
				}
			)

	# Sort by modification time (oldest first = order in which changes were made)
	changes.sort(key=lambda c: c.get("_modified") or "")
	# Remove internal _modified field before returning
	for change in changes:
		change.pop("_modified", None)

	return changes


@frappe.whitelist()
def submit_change_request(name: str) -> None:
	"""Send a Draft / Changes-Requested CR into review.

	The author submits their own work; no reviewer is picked here (reviewer
	discovery is native assignment, see the review-flow spec). We re-check
	server-side that the CR actually has changes — the UI gate is not enough.
	"""
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("write")
	_assert_status(cr, {"Draft", "Changes Requested"})

	if not has_revision_changes(cr.base_revision, cr.head_revision):
		frappe.throw(_("There are no changes to submit for review."), frappe.ValidationError)

	cr.status = "In Review"
	cr.save()


@frappe.whitelist()
def approve_change_request(name: str) -> None:
	"""Approve an in-review CR. Does not publish — merge is a separate action."""
	cr = frappe.get_doc("Wiki Change Request", name)
	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to review change requests in this space."),
			frappe.PermissionError,
		)
	_assert_status(cr, {"In Review"})

	cr.status = "Approved"
	cr.reviewed_by = frappe.session.user
	cr.reviewed_at = now_datetime()
	cr.save()
	cr.add_comment("Comment", _("Approved this change request."))
	_notify_cr_owner(cr, _("Your change request “{0}” was approved.").format(cr.title))


@frappe.whitelist()
def request_changes(name: str, comment: str) -> None:
	"""Send an in-review (or approved) CR back to the author with feedback.

	The comment is required — it is the author's only signal for what to fix —
	and is stored on the CR so the author's banner can surface it.
	"""
	comment = (comment or "").strip()
	if not comment:
		frappe.throw(_("Please provide feedback explaining what needs to change."), frappe.ValidationError)

	cr = frappe.get_doc("Wiki Change Request", name)
	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to review change requests in this space."),
			frappe.PermissionError,
		)
	_assert_status(cr, {"In Review", "Approved"})

	cr.status = "Changes Requested"
	cr.review_comment = comment
	cr.reviewed_by = frappe.session.user
	cr.reviewed_at = now_datetime()
	cr.save()
	cr.add_comment("Comment", _("Requested changes: {0}").format(comment))
	_notify_cr_owner(cr, _("Changes were requested on your change request “{0}”.").format(cr.title))


@frappe.whitelist()
def reject_change_request(name: str, comment: str) -> None:
	"""Reject an in-review (or approved) CR. Terminal — it will not be merged.

	Like `request_changes` a comment is required (it is the rejection reason the
	author reads), but unlike it `Rejected` is a dead end: the author cannot
	resubmit, only archive-and-start-over.
	"""
	comment = (comment or "").strip()
	if not comment:
		frappe.throw(_("Please provide a reason for rejecting this change request."), frappe.ValidationError)

	cr = frappe.get_doc("Wiki Change Request", name)
	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to review change requests in this space."),
			frappe.PermissionError,
		)
	_assert_status(cr, {"In Review", "Approved"})

	cr.status = "Rejected"
	cr.review_comment = comment
	cr.reviewed_by = frappe.session.user
	cr.reviewed_at = now_datetime()
	cr.rejected_at = now_datetime()
	cr.save()
	cr.add_comment("Comment", _("Rejected this change request: {0}").format(comment))
	_notify_cr_owner(cr, _("Your change request “{0}” was rejected.").format(cr.title))


@frappe.whitelist()
def withdraw_change_request(name: str) -> None:
	"""Author pulls an in-review CR back to Draft, re-opening it for editing.

	Author (owner) only; managers may also withdraw. No comment — this is the
	author retracting their own submission, not a reviewer decision.
	"""
	from wiki.permissions import _is_manager

	cr = frappe.get_doc("Wiki Change Request", name)
	if cr.owner != frappe.session.user and not _is_manager():
		frappe.throw(
			_("Only the author can withdraw this change request."),
			frappe.PermissionError,
		)
	_assert_status(cr, {"In Review"})

	cr.status = "Draft"
	cr.save()


@frappe.whitelist()
def merge_change_request(name: str) -> str:
	cr = frappe.get_doc("Wiki Change Request", name)
	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to merge change requests in this space."),
			frappe.PermissionError,
		)

	# Merge requires an explicit Approved decision; reject anything already
	# finalized so a re-fired request can't re-merge or revive a closed CR.
	_assert_status(cr, {"Approved"})

	space = frappe.get_doc("Wiki Space", cr.wiki_space)

	if cr.base_revision == space.main_revision:
		return _fast_forward_merge(cr, space)
	return _three_way_merge(cr, space)


@frappe.whitelist()
def get_merge_conflicts(name: str) -> list[dict[str, Any]]:
	"""Return open merge conflicts for a change request."""
	cr_space = frappe.db.get_value("Wiki Change Request", name, "wiki_space")
	if not _can_merge(cr_space):
		frappe.throw(
			_("You do not have permission to view merge conflicts in this space."),
			frappe.PermissionError,
		)

	conflicts = frappe.get_all(
		"Wiki Merge Conflict",
		filters={"change_request": name, "status": "Open"},
		fields=["name", "doc_key", "conflict_type", "ours_payload", "theirs_payload"],
	)

	for conflict in conflicts:
		ours = conflict.get("ours_payload")
		theirs = conflict.get("theirs_payload")
		if isinstance(ours, str):
			ours = frappe.parse_json(ours)
		if isinstance(theirs, str):
			theirs = frappe.parse_json(theirs)
		conflict["ours_title"] = (ours or {}).get("title", "")
		conflict["theirs_title"] = (theirs or {}).get("title", "")

		# Resolve content from content_blob references
		ours_blob = (ours or {}).get("content_blob")
		theirs_blob = (theirs or {}).get("content_blob")
		conflict["ours_content"] = (
			(frappe.get_value("Wiki Content Blob", ours_blob, "content") or "") if ours_blob else ""
		)
		conflict["theirs_content"] = (
			(frappe.get_value("Wiki Content Blob", theirs_blob, "content") or "") if theirs_blob else ""
		)

	return conflicts


@frappe.whitelist()
def resolve_merge_conflict(conflict_name: str, resolution: str) -> None:
	"""Resolve a single merge conflict by choosing 'ours' or 'theirs'."""
	if resolution not in ("ours", "theirs"):
		frappe.throw(_("Resolution must be 'ours' or 'theirs'."), frappe.ValidationError)

	conflict = frappe.get_doc("Wiki Merge Conflict", conflict_name)

	# Validate the parent change request is in an allowed state
	cr = frappe.get_doc("Wiki Change Request", conflict.change_request)

	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to resolve conflicts in this space."),
			frappe.PermissionError,
		)
	if cr.status in ("Merged", "Archived"):
		frappe.throw(_("Cannot resolve conflicts for a finalized Change Request."), frappe.ValidationError)

	if conflict.status == "Resolved":
		frappe.throw(_("Conflict is already resolved."), frappe.ValidationError)

	payload = conflict.ours_payload if resolution == "ours" else conflict.theirs_payload
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)

	conflict.resolution = resolution
	conflict.resolved_payload = payload
	conflict.resolved_by = frappe.session.user
	conflict.resolved_at = now_datetime()
	conflict.status = "Resolved"
	conflict.save(ignore_permissions=True)


@frappe.whitelist()
def retry_merge_after_resolution(name: str) -> str:
	"""Retry a merge after all conflicts have been resolved."""
	cr = frappe.get_doc("Wiki Change Request", name)
	if not _can_merge(cr.wiki_space):
		frappe.throw(
			_("You do not have permission to merge in this space."),
			frappe.PermissionError,
		)

	space = frappe.get_doc("Wiki Space", cr.wiki_space)

	# Verify all conflicts are resolved
	open_conflicts = frappe.db.count("Wiki Merge Conflict", {"change_request": name, "status": "Open"})
	if open_conflicts:
		frappe.throw(
			_("{0} conflict(s) still unresolved.").format(open_conflicts),
			frappe.ValidationError,
		)

	resolved_conflicts = frappe.get_all(
		"Wiki Merge Conflict",
		filters={"change_request": name, "status": "Resolved"},
		fields=["doc_key", "resolved_payload", "resolution"],
	)
	resolved_map: dict[str, dict[str, Any]] = {}
	resolution_side: dict[str, str] = {}
	for rc in resolved_conflicts:
		payload = rc.get("resolved_payload")
		if isinstance(payload, str):
			payload = frappe.parse_json(payload)
		resolved_map[rc["doc_key"]] = payload
		resolution_side[rc["doc_key"]] = rc.get("resolution", "")

	# Rebuild the merge: start from current main, apply non-conflicting + resolved
	base_items = get_revision_item_map(cr.base_revision)
	ours_items = get_revision_item_map(space.main_revision)
	theirs_items = get_effective_revision_item_map(cr.head_revision)

	main_changed = _find_changed_keys(base_items, ours_items)
	head_changed = _find_changed_keys(base_items, theirs_items)
	changed_keys = main_changed | head_changed

	base_subset = {k: base_items[k] for k in changed_keys if k in base_items}
	ours_subset = {k: ours_items[k] for k in changed_keys if k in ours_items}
	theirs_subset = {k: theirs_items[k] for k in changed_keys if k in theirs_items}

	base_contents = get_contents_for_items(base_subset)
	ours_contents = get_contents_for_items(ours_subset)
	theirs_contents = get_contents_for_items(theirs_subset)

	# Start with current main state
	merged_items: dict[str, dict[str, Any]] = {}
	for key, item in ours_items.items():
		normalized = normalize_item(item)
		if normalized:
			merged_items[key] = normalized

	new_conflicts = []
	for key in changed_keys:
		if key in resolved_map:
			# Use the resolved payload (with content_blob already set)
			resolved = resolved_map[key]
			if resolved:
				# Ensure content_blob exists — resolve from the chosen side's payload
				if not resolved.get("content_blob"):
					# Re-derive content blob from ours/theirs content
					res = resolution_side.get(key)
					if res:
						content = (
							ours_contents.get(key, "") if res == "ours" else theirs_contents.get(key, "")
						)
						resolved = with_content_blob(resolved, content)
				merged_items[key] = resolved
			else:
				merged_items.pop(key, None)
			continue

		base = normalize_item(base_items.get(key))
		ours = normalize_item(ours_items.get(key))
		theirs = normalize_item(theirs_items.get(key))
		base_content = base_contents.get(key, "")
		ours_content = ours_contents.get(key, "")
		theirs_content = theirs_contents.get(key, "")

		result, _conflict_type = merge_items(base, ours, theirs, base_content, ours_content, theirs_content)
		if _conflict_type:
			new_conflicts.append(
				{
					"doc_key": key,
					"type": _conflict_type,
					"base": base,
					"ours": ours,
					"theirs": theirs,
				}
			)
			continue
		if result:
			merged_items[key] = result
		else:
			merged_items.pop(key, None)

	if new_conflicts:
		for conflict_data in new_conflicts:
			conflict_doc = frappe.new_doc("Wiki Merge Conflict")
			conflict_doc.change_request = cr.name
			conflict_doc.doc_key = conflict_data["doc_key"]
			conflict_doc.conflict_type = conflict_data["type"]
			conflict_doc.base_payload = conflict_data["base"]
			conflict_doc.ours_payload = conflict_data["ours"]
			conflict_doc.theirs_payload = conflict_data["theirs"]
			conflict_doc.status = "Open"
			conflict_doc.insert(ignore_permissions=True)

		if not frappe.flags.in_test:
			frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		frappe.throw(
			_("{0} new conflict(s) detected during merge retry.").format(len(new_conflicts)),
			frappe.ValidationError,
		)

	_fix_orphaned_items(merged_items, ours_items)
	merge_revision = create_merge_revision(cr, merged_items)

	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_changes_only(space, merge_revision, ours_items)
	finally:
		frappe.flags.in_apply_merge_revision = False

	_finalize_merge(cr, merge_revision)
	return merge_revision.name


@frappe.whitelist()
def check_outdated(name: str) -> int:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("write")
	main_revision = frappe.get_value("Wiki Space", cr.wiki_space, "main_revision")
	outdated = 1 if main_revision and main_revision != cr.base_revision else 0
	frappe.db.set_value("Wiki Change Request", cr.name, "outdated", outdated)
	return outdated


def _fast_forward_merge(cr: Document, space: Document) -> str:
	"""Fast-forward merge: no concurrent changes since CR was created."""
	base_items = get_revision_item_map(cr.base_revision)
	effective_items = get_effective_revision_item_map(cr.head_revision)

	merged_items: dict[str, dict[str, Any]] = {}
	for key, item in effective_items.items():
		normalized = normalize_item(item)
		if normalized:
			merged_items[key] = normalized

	_fix_orphaned_items(merged_items, effective_items)
	merge_revision = create_merge_revision(cr, merged_items)

	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_changes_only(space, merge_revision, base_items)
	finally:
		frappe.flags.in_apply_merge_revision = False

	_finalize_merge(cr, merge_revision)
	return merge_revision.name


def _three_way_merge(cr: Document, space: Document) -> str:
	"""Three-way merge: concurrent changes require conflict resolution."""
	base_items = get_revision_item_map(cr.base_revision)
	ours_items = get_revision_item_map(space.main_revision)
	theirs_items = get_effective_revision_item_map(cr.head_revision)

	# Only load content for keys that actually changed in either branch
	main_changed = _find_changed_keys(base_items, ours_items)
	head_changed = _find_changed_keys(base_items, theirs_items)
	changed_keys = main_changed | head_changed

	base_subset = {k: base_items[k] for k in changed_keys if k in base_items}
	ours_subset = {k: ours_items[k] for k in changed_keys if k in ours_items}
	theirs_subset = {k: theirs_items[k] for k in changed_keys if k in theirs_items}

	base_contents = get_contents_for_items(base_subset)
	ours_contents = get_contents_for_items(ours_subset)
	theirs_contents = get_contents_for_items(theirs_subset)

	# Start with current main state as baseline for merged result
	merged_items: dict[str, dict[str, Any]] = {}
	for key, item in ours_items.items():
		normalized = normalize_item(item)
		if normalized:
			merged_items[key] = normalized

	conflicts = []
	for key in changed_keys:
		base = normalize_item(base_items.get(key))
		ours = normalize_item(ours_items.get(key))
		theirs = normalize_item(theirs_items.get(key))
		base_content = base_contents.get(key, "")
		ours_content = ours_contents.get(key, "")
		theirs_content = theirs_contents.get(key, "")

		result, conflict_type = merge_items(base, ours, theirs, base_content, ours_content, theirs_content)
		if conflict_type:
			conflicts.append(
				{"doc_key": key, "type": conflict_type, "base": base, "ours": ours, "theirs": theirs}
			)
			continue
		if result:
			merged_items[key] = result
		else:
			merged_items.pop(key, None)

	if conflicts:
		for conflict in conflicts:
			conflict_doc = frappe.new_doc("Wiki Merge Conflict")
			conflict_doc.change_request = cr.name
			conflict_doc.doc_key = conflict["doc_key"]
			conflict_doc.conflict_type = conflict["type"]
			conflict_doc.base_payload = conflict["base"]
			conflict_doc.ours_payload = conflict["ours"]
			conflict_doc.theirs_payload = conflict["theirs"]
			conflict_doc.status = "Open"
			conflict_doc.insert(ignore_permissions=True)

		if not frappe.flags.in_test:
			frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

		frappe.throw(_("Merge conflicts detected"), frappe.ValidationError)

	_fix_orphaned_items(merged_items, ours_items)
	merge_revision = create_merge_revision(cr, merged_items)

	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_changes_only(space, merge_revision, ours_items)
	finally:
		frappe.flags.in_apply_merge_revision = False

	_finalize_merge(cr, merge_revision)
	return merge_revision.name


def _find_changed_keys(
	base_items: dict[str, dict[str, Any]], other_items: dict[str, dict[str, Any]]
) -> set[str]:
	"""Find doc_keys that differ between two revision item maps.

	Compares metadata and content_blob without loading actual content text.
	"""
	changed: set[str] = set()
	all_keys = set(base_items) | set(other_items)
	compare_fields = [
		"title",
		"slug",
		"route",
		"parent_key",
		"order_index",
		"is_group",
		"is_published",
		"is_external_link",
		"external_url",
		"content_blob",
		"is_deleted",
	]

	for key in all_keys:
		base = base_items.get(key)
		other = other_items.get(key)
		if base is None or other is None:
			changed.add(key)
			continue

		for field in compare_fields:
			if base.get(field) != other.get(field):
				changed.add(key)
				break

	return changed


def _fix_orphaned_items(
	merged_items: dict[str, dict[str, Any]],
	reference_items: dict[str, dict[str, Any]],
) -> None:
	"""Reparent items whose parent_key points to a doc not in merged_items.

	When a parent is deleted but a child is kept (e.g. conflict resolved as
	'ours'), the child's parent_key still references the deleted doc.  Walk up
	the ancestry chain via *reference_items* until we find a living ancestor
	that exists in merged_items, then update the child's parent_key.
	"""
	existing_keys = set(merged_items)
	for item in merged_items.values():
		parent_key = item.get("parent_key")
		if not parent_key or parent_key in existing_keys:
			continue
		# Walk up ancestry until we find a key present in merged_items
		ancestor = parent_key
		while ancestor and ancestor not in existing_keys:
			ref = reference_items.get(ancestor)
			ancestor = ref.get("parent_key") if ref else None
		item["parent_key"] = ancestor


def _delete_wiki_documents(doc_keys: Iterable[str], key_to_name: dict[str, str], root_doc_key: str) -> None:
	"""Delete Wiki Documents by doc_key, children-first (highest lft first)."""
	delete_docs = []
	for doc_key in doc_keys:
		if doc_key == root_doc_key:
			continue
		if doc_key in key_to_name:
			doc_name = key_to_name[doc_key]
			lft = frappe.db.get_value("Wiki Document", doc_name, "lft") or 0
			delete_docs.append((lft, doc_key, doc_name))
	delete_docs.sort(key=lambda x: x[0], reverse=True)
	for _lft, doc_key, doc_name in delete_docs:
		frappe.delete_doc("Wiki Document", doc_name, force=True)
		del key_to_name[doc_key]


def _reconcile_sort_order(
	new_items: dict[str, dict[str, Any]],
	key_to_name: dict[str, str],
	changed_keys: set[str],
) -> None:
	"""Fix sort_order on unchanged docs that are out of sync with the revision.

	The merge only updates changed items. If sort_order drifted earlier (e.g.
	set_sort_order_for_new_document overriding order_index=0 during a prior
	merge), unchanged items would stay wrong forever. This does a batch fix
	for any remaining mismatches.
	"""
	unchanged_keys = set(new_items) - changed_keys
	if not unchanged_keys:
		return

	doc_names = [key_to_name[k] for k in unchanged_keys if k in key_to_name]
	if not doc_names:
		return

	live_docs = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key", "sort_order"],
		filters={"name": ("in", doc_names)},
	)
	live_sort = {doc["doc_key"]: doc for doc in live_docs}

	for doc_key in unchanged_keys:
		if doc_key not in live_sort:
			continue
		expected = new_items[doc_key].get("order_index") or 0
		actual = live_sort[doc_key].get("sort_order") or 0
		if expected != actual:
			frappe.db.set_value(
				"Wiki Document",
				live_sort[doc_key]["name"],
				"sort_order",
				expected,
				update_modified=False,
			)


def _classify_changes(
	prev_items: dict[str, dict[str, Any]],
	new_items: dict[str, dict[str, Any]],
	changed_keys: set[str],
) -> tuple[set[str], set[str], set[str], set[str]]:
	"""Classify changed keys into (content_only, structural, added, deleted)."""
	content_only: set[str] = set()
	structural: set[str] = set()
	added: set[str] = set()
	deleted: set[str] = set()
	metadata_fields = [
		"title",
		"slug",
		"route",
		"parent_key",
		"order_index",
		"is_group",
		"is_published",
		"is_external_link",
		"external_url",
	]

	for key in changed_keys:
		prev = prev_items.get(key)
		new = new_items.get(key)

		prev_exists = prev is not None and not prev.get("is_deleted")
		new_exists = new is not None and not new.get("is_deleted")

		if not prev_exists and new_exists:
			added.add(key)
		elif prev_exists and not new_exists:
			deleted.add(key)
		elif prev_exists and new_exists:
			if all(prev.get(f) == new.get(f) for f in metadata_fields):
				content_only.add(key)
			else:
				structural.add(key)

	return content_only, structural, added, deleted


def _apply_merge_changes_only(
	space: Document,
	merge_revision: Document,
	prev_items: dict[str, dict[str, Any]],
) -> None:
	"""Apply only changed documents to the live tree.

	Instead of loading and saving every document, finds the delta between
	prev_items (the old main_revision state) and the merge_revision, then:
	- Deletes removed docs
	- Uses frappe.db.set_value for content-only changes (skips validation)
	- Does full doc.save() only for structural changes and additions
	"""
	new_items = get_revision_item_map(merge_revision.name)
	changed_keys = _find_changed_keys(prev_items, new_items)

	if not changed_keys:
		frappe.db.set_value("Wiki Space", space.name, "main_revision", merge_revision.name)
		return

	root_doc_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

	root_lft, root_rgt = frappe.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
	space_docs = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key"],
		filters=[
			["lft", ">=", root_lft],
			["rgt", "<=", root_rgt],
			["doc_key", "is", "set"],
		],
	)
	key_to_name = {doc["doc_key"]: doc["name"] for doc in space_docs}

	content_only_keys, structural_keys, added_keys, deleted_keys = _classify_changes(
		prev_items, new_items, changed_keys
	)

	# Batch-load content blobs for all non-deleted changed items (1 query)
	need_content_keys = content_only_keys | structural_keys | added_keys
	blob_names: set[str] = set()
	for k in need_content_keys:
		item = new_items.get(k)
		if item and item.get("content_blob"):
			blob_names.add(item["content_blob"])

	blob_contents: dict[str, str] = {}
	if blob_names:
		blobs = frappe.get_all(
			"Wiki Content Blob",
			fields=["name", "content"],
			filters={"name": ("in", list(blob_names))},
		)
		blob_contents = {blob["name"]: blob.get("content") or "" for blob in blobs}

	# Content-only fast path: direct DB update, skip doc.save() validation
	for doc_key in content_only_keys:
		if doc_key not in key_to_name:
			continue
		item = new_items[doc_key]
		content_blob = item.get("content_blob")
		content = blob_contents.get(content_blob, "") if content_blob else ""
		frappe.db.set_value("Wiki Document", key_to_name[doc_key], "content", content)

	# Structural changes and additions need full save (process in tree order)
	full_save_keys = structural_keys | added_keys
	if full_save_keys:
		ordered_keys = build_tree_order(new_items)
		for doc_key in ordered_keys:
			if doc_key not in full_save_keys:
				continue

			item = new_items[doc_key]
			if item.get("is_deleted"):
				continue

			parent_name = None
			if doc_key == root_doc_key:
				parent_name = None
			elif item.get("parent_key"):
				parent_name = key_to_name.get(item.get("parent_key"))
			elif space.root_group:
				parent_name = space.root_group

			if doc_key in key_to_name:
				doc = frappe.get_doc("Wiki Document", key_to_name[doc_key])
			else:
				existing_name = frappe.db.get_value("Wiki Document", {"doc_key": doc_key}, "name")
				if existing_name:
					doc = frappe.get_doc("Wiki Document", existing_name)
				else:
					doc = frappe.new_doc("Wiki Document")
					doc.doc_key = doc_key

			doc.title = item.get("title")
			doc.slug = item.get("slug") or cleanup_page_name(item.get("title") or "")
			if item.get("route"):
				doc.route = item["route"]
			doc.is_group = item.get("is_group")
			doc.is_published = item.get("is_published")
			doc.is_external_link = item.get("is_external_link")
			doc.external_url = item.get("external_url")
			if doc_key == root_doc_key:
				doc.parent_wiki_document = None
			else:
				doc.parent_wiki_document = parent_name or space.root_group
			doc.sort_order = item.get("order_index") or 0

			content_blob = item.get("content_blob")
			doc.content = blob_contents.get(content_blob, "") if content_blob else ""

			if doc.is_new():
				doc.insert()
				key_to_name[doc_key] = doc.name
			else:
				doc.save()

	# Delete AFTER saves — children must be reparented before parents are deleted
	_delete_wiki_documents(deleted_keys, key_to_name, root_doc_key)

	# Reconcile sort_order for unchanged items whose live value drifted
	_reconcile_sort_order(new_items, key_to_name, changed_keys)

	frappe.db.set_value("Wiki Space", space.name, "main_revision", merge_revision.name)


def _finalize_merge(cr: Document, merge_revision: Document) -> None:
	"""Update CR status after successful merge."""
	cr.status = "Merged"
	cr.merge_revision = merge_revision.name
	cr.merged_by = frappe.session.user
	cr.merged_at = now_datetime()
	cr.save()
	_notify_cr_owner(cr, _("Your change request “{0}” was merged.").format(cr.title))


def normalize_item(item: dict[str, Any] | None) -> dict[str, Any] | None:
	if not item or item.get("is_deleted"):
		return None
	return {
		"doc_key": item.get("doc_key"),
		"title": item.get("title"),
		"slug": item.get("slug"),
		"route": item.get("route"),
		"is_group": item.get("is_group"),
		"is_published": item.get("is_published"),
		"is_external_link": item.get("is_external_link"),
		"external_url": item.get("external_url"),
		"parent_key": item.get("parent_key"),
		"order_index": item.get("order_index"),
		"content_hash": item.get("content_hash"),
		"content_blob": item.get("content_blob"),
	}


def merge_items(
	base: dict[str, Any] | None,
	ours: dict[str, Any] | None,
	theirs: dict[str, Any] | None,
	base_content: str,
	ours_content: str,
	theirs_content: str,
) -> tuple[dict[str, Any] | None, str | None]:
	if base is None and ours is None and theirs is None:
		return None, None

	if base is None:
		if ours is None:
			return with_content_blob(theirs, theirs_content), None
		if theirs is None:
			return with_content_blob(ours, ours_content), None
		if items_equal(ours, ours_content, theirs, theirs_content):
			return with_content_blob(ours, ours_content), None
		return None, "content"

	# base exists
	if ours is None and theirs is None:
		return None, None
	if ours is None and theirs is not None:
		if items_equal(theirs, theirs_content, base, base_content):
			return None, None
		return None, "content"
	if theirs is None and ours is not None:
		if items_equal(ours, ours_content, base, base_content):
			return None, None
		return None, "content"

	# both ours and theirs exist
	if items_equal(ours, ours_content, theirs, theirs_content):
		return with_content_blob(ours, ours_content), None

	if items_equal(ours, ours_content, base, base_content):
		return with_content_blob(theirs, theirs_content), None
	if items_equal(theirs, theirs_content, base, base_content):
		return with_content_blob(ours, ours_content), None

	# detect tree conflicts separately
	if ours.get("parent_key") != theirs.get("parent_key") or ours.get("order_index") != theirs.get(
		"order_index"
	):
		return None, "tree"
	if conflict_on_metadata(base, ours, theirs):
		return None, "meta"

	normalized_base = normalize_merge_text(base_content)
	normalized_ours = normalize_merge_text(ours_content)
	normalized_theirs = normalize_merge_text(theirs_content)
	merged_content, conflict = merge_content_three_way(normalized_base, normalized_ours, normalized_theirs)
	if conflict:
		return None, "content"

	merged = {
		"doc_key": ours.get("doc_key"),
		"title": resolve_field(base.get("title"), ours.get("title"), theirs.get("title")),
		"slug": resolve_field(base.get("slug"), ours.get("slug"), theirs.get("slug")),
		"route": resolve_field(base.get("route"), ours.get("route"), theirs.get("route")),
		"is_group": resolve_field(base.get("is_group"), ours.get("is_group"), theirs.get("is_group")),
		"is_published": resolve_field(
			base.get("is_published"), ours.get("is_published"), theirs.get("is_published")
		),
		"parent_key": ours.get("parent_key"),
		"order_index": ours.get("order_index"),
	}
	return with_content_blob(merged, merged_content), None


def items_equal(
	item_a: dict[str, Any] | None,
	content_a: str,
	item_b: dict[str, Any] | None,
	content_b: str,
) -> bool:
	if item_a is None and item_b is None:
		return True
	if item_a is None or item_b is None:
		return False
	compare_fields = ["title", "slug", "route", "is_group", "is_published", "parent_key", "order_index"]
	for field in compare_fields:
		if item_a.get(field) != item_b.get(field):
			return False
	return content_a == content_b


def conflict_on_metadata(base: dict[str, Any], ours: dict[str, Any], theirs: dict[str, Any]) -> bool:
	metadata_fields = ["title", "slug", "route", "is_group", "is_published"]
	for field in metadata_fields:
		base_value = base.get(field)
		ours_value = ours.get(field)
		theirs_value = theirs.get(field)
		if ours_value == theirs_value:
			continue
		if ours_value == base_value or theirs_value == base_value:
			continue
		return True
	return False


def resolve_field(base_value: Any, ours_value: Any, theirs_value: Any) -> Any:
	if ours_value == theirs_value:
		return ours_value
	if ours_value == base_value:
		return theirs_value
	if theirs_value == base_value:
		return ours_value
	return ours_value


def merge_content_three_way(base: str, ours: str, theirs: str) -> tuple[str, bool]:
	"""Three-way content merge.  Returns (merged_content, has_conflict).

	Strategies tried in order:
	1. Trivial: ours == theirs, or one side == base
	2. Same-length line-by-line merge (rstrip for whitespace tolerance)
	3. Diff-based merge with disjoint-edit detection
	4. If edits overlap -> conflict
	"""
	# 1. Trivial cases
	if ours == theirs:
		return ours, False
	if ours == base:
		return theirs, False
	if theirs == base:
		return ours, False

	# 2. Same-length line-by-line merge with rstrip tolerance
	base_lines = base.splitlines()
	ours_lines = ours.splitlines()
	theirs_lines = theirs.splitlines()

	if len(base_lines) == len(ours_lines) == len(theirs_lines):
		merged: list[str] = []
		for b, o, t in zip(base_lines, ours_lines, theirs_lines, strict=False):
			if o.rstrip() == t.rstrip():
				merged.append(o)
			elif o.rstrip() == b.rstrip():
				merged.append(t)
			elif t.rstrip() == b.rstrip():
				merged.append(o)
			else:
				merged = []
				break
		if merged:
			ending = "\n" if base.endswith("\n") or ours.endswith("\n") or theirs.endswith("\n") else ""
			return "\n".join(merged) + ending, False

	# 3. Diff-based merge with disjoint-edit check
	base_lines_ke = base.splitlines(keepends=True)
	ours_lines_ke = ours.splitlines(keepends=True)
	theirs_lines_ke = theirs.splitlines(keepends=True)

	ours_edits = diff_edits(base_lines_ke, ours_lines_ke)
	theirs_edits = diff_edits(base_lines_ke, theirs_lines_ke)

	if edits_disjoint(ours_edits, theirs_edits):
		merged_lines = apply_edits(base_lines_ke, combine_edits(ours_edits, theirs_edits))
		return "".join(merged_lines), False

	# 4. Edits overlap -> conflict
	return "", True


def normalize_merge_text(content: str) -> str:
	content = (content or "").replace("\r\n", "\n").replace("\r", "\n")
	lines = [line.rstrip() for line in content.split("\n")]
	return "\n".join(lines)


def diff_edits(base_lines: list[str], new_lines: list[str]) -> list[tuple[int, int, list[str]]]:
	import difflib

	matcher = difflib.SequenceMatcher(a=base_lines, b=new_lines)
	edits: list[tuple[int, int, list[str]]] = []
	for tag, i1, i2, j1, j2 in matcher.get_opcodes():
		if tag == "equal":
			continue
		edits.append((i1, i2, new_lines[j1:j2]))
	return edits


def edits_disjoint(
	ours_edits: list[tuple[int, int, list[str]]],
	theirs_edits: list[tuple[int, int, list[str]]],
) -> bool:
	def changed_lines(edits: list[tuple[int, int, list[str]]]) -> set[int]:
		changed: set[int] = set()
		for start, end, _lines in edits:
			if start == end:
				changed.add(start)
			else:
				changed.update(range(start, end))
		return changed

	return changed_lines(ours_edits).isdisjoint(changed_lines(theirs_edits))


def combine_edits(
	ours_edits: list[tuple[int, int, list[str]]],
	theirs_edits: list[tuple[int, int, list[str]]],
) -> list[tuple[int, int, list[str]]]:
	all_edits = ours_edits + theirs_edits
	all_edits.sort(key=lambda edit: (edit[0], edit[1]))
	combined: list[tuple[int, int, list[str]]] = []
	for edit in all_edits:
		if combined and edit[0] == combined[-1][0] and edit[1] == combined[-1][1] and edit[0] == edit[1]:
			if combined[-1][2] == edit[2]:
				continue
		combined.append(edit)
	return combined


def apply_edits(base_lines: list[str], edits: list[tuple[int, int, list[str]]]) -> list[str]:
	result = []
	cursor = 0
	for start, end, replacement in edits:
		if start < cursor:
			continue
		result.extend(base_lines[cursor:start])
		result.extend(replacement)
		cursor = end
	result.extend(base_lines[cursor:])
	return result


def get_contents_for_items(items: dict[str, dict[str, Any]]) -> dict[str, str]:
	blob_names = {item.get("content_blob") for item in items.values() if item.get("content_blob")}
	if not blob_names:
		return {}
	contents = frappe.get_all(
		"Wiki Content Blob",
		fields=["name", "content"],
		filters={"name": ("in", list(blob_names))},
	)
	blob_map = {row["name"]: row.get("content") or "" for row in contents}
	return {key: blob_map.get(item.get("content_blob"), "") for key, item in items.items()}


def with_content_blob(item: dict[str, Any] | None, content: str) -> dict[str, Any] | None:
	if not item:
		return None
	item = dict(item)
	item["content_blob"] = get_or_create_content_blob(content)
	item["content_hash"] = None
	return item


def create_merge_revision(cr: Document, merged_items: dict[str, dict[str, Any]]) -> Document:
	revision = frappe.new_doc("Wiki Revision")
	revision.wiki_space = cr.wiki_space
	revision.change_request = cr.name
	revision.parent_revision = cr.base_revision
	revision.message = f"Merge {cr.name}"
	revision.is_merge = 1
	revision.is_working = 0
	revision.created_by = frappe.session.user
	revision.created_at = now_datetime()
	revision.insert()

	for item in merged_items.values():
		new_item = frappe.new_doc("Wiki Revision Item")
		new_item.revision = revision.name
		new_item.doc_key = item.get("doc_key")
		new_item.title = item.get("title")
		new_item.slug = item.get("slug")
		new_item.route = item.get("route")
		new_item.is_group = item.get("is_group")
		new_item.is_published = item.get("is_published")
		new_item.is_external_link = item.get("is_external_link")
		new_item.external_url = item.get("external_url")
		new_item.parent_key = item.get("parent_key")
		new_item.order_index = item.get("order_index")
		new_item.content_blob = item.get("content_blob")
		new_item.is_deleted = 0
		new_item.insert()

	recompute_revision_hashes(revision.name)
	return revision


def apply_merge_revision(space: Document, revision: Document) -> None:
	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_revision(space, revision)
	finally:
		frappe.flags.in_apply_merge_revision = False


def _apply_merge_revision(space: Document, revision: Document) -> None:
	items = get_revision_item_map(revision.name)
	ordered_keys = build_tree_order(items)
	root_doc_key = frappe.get_value("Wiki Document", space.root_group, "doc_key")

	# Get all docs in this wiki space using nested set model
	root_lft, root_rgt = frappe.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
	space_docs = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key"],
		filters=[
			["lft", ">=", root_lft],
			["rgt", "<=", root_rgt],
			["doc_key", "is", "set"],
		],
	)
	key_to_name = {doc["doc_key"]: doc["name"] for doc in space_docs}

	# Collect docs to delete (exist in space but not in merge revision)
	delete_doc_keys: set[str] = set()
	for doc_key in list(key_to_name):
		if doc_key == root_doc_key:
			continue
		if doc_key not in items:
			delete_doc_keys.add(doc_key)

	for doc_key in ordered_keys:
		item = items[doc_key]
		if item.get("is_deleted"):
			continue

		parent_name = None
		if doc_key == root_doc_key:
			parent_name = None
		elif item.get("parent_key"):
			parent_name = key_to_name.get(item.get("parent_key"))
		elif space.root_group:
			parent_name = space.root_group

		if doc_key in key_to_name:
			doc = frappe.get_doc("Wiki Document", key_to_name[doc_key])
		else:
			# Check if a document with this doc_key exists outside the space's tree
			existing_name = frappe.db.get_value("Wiki Document", {"doc_key": doc_key}, "name")
			if existing_name:
				doc = frappe.get_doc("Wiki Document", existing_name)
			else:
				doc = frappe.new_doc("Wiki Document")
				doc.doc_key = doc_key

		doc.title = item.get("title")
		doc.slug = item.get("slug") or cleanup_page_name(item.get("title") or "")
		if item.get("route"):
			doc.route = item["route"]
		doc.is_group = item.get("is_group")
		doc.is_published = item.get("is_published")
		doc.is_external_link = item.get("is_external_link")
		doc.external_url = item.get("external_url")
		if doc_key == root_doc_key:
			doc.parent_wiki_document = None
		else:
			doc.parent_wiki_document = parent_name or space.root_group
		doc.sort_order = item.get("order_index") or 0

		content_blob = item.get("content_blob")
		if content_blob:
			content = frappe.get_value("Wiki Content Blob", content_blob, "content")
			doc.content = content

		if doc.is_new():
			doc.insert()
			key_to_name[doc_key] = doc.name
		else:
			doc.save()

	# Delete AFTER saves — children must be reparented before parents are deleted
	_delete_wiki_documents(delete_doc_keys, key_to_name, root_doc_key)

	frappe.db.set_value("Wiki Space", space.name, "main_revision", revision.name)
