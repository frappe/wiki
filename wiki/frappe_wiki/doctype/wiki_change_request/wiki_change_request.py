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
	clone_revision,
	create_revision_from_live_tree,
	get_or_create_content_blob,
	get_revision_item_map,
	recompute_revision_hashes,
)


class WikiChangeRequest(Document):
	pass


@frappe.whitelist()
def get_change_request(name: str) -> dict[str, Any]:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("read")
	return cr.as_dict()


def _is_manager_or_approver(user: str | None = None) -> bool:
	roles = set(frappe.get_roles(user or frappe.session.user))
	return bool(roles.intersection({"Wiki Manager", "Wiki Approver", "System Manager"}))


def touch_change_request(name: str) -> None:
	frappe.db.set_value(
		"Wiki Change Request",
		name,
		{"modified": now_datetime(), "modified_by": frappe.session.user},
		update_modified=False,
	)


def _validate_unique_leaf_slug_in_revision(
	revision: str,
	doc_key: str,
	parent_key: str | None,
	slug: str | None,
	*,
	is_group: int | bool = 0,
	is_deleted: int | bool = 0,
) -> None:
	"""Prevent invalid trees inside a revision.

	A leaf's route is derived from ancestor slugs + its slug. Two leaf nodes with the same
	(parent_key, slug) will compute the same route and fail at merge time.
	"""
	if is_deleted or is_group or not slug:
		return

	# Treat empty parent_key and None as equivalent.
	parent_key = parent_key or None

	existing = frappe.db.get_value(
		"Wiki Revision Item",
		{
			"revision": revision,
			"parent_key": parent_key,
			"slug": slug,
			"is_group": 0,
			"is_deleted": 0,
			"doc_key": ("!=", doc_key),
		},
		["name", "doc_key", "title"],
		as_dict=True,
	)
	if existing:
		frappe.throw(
			_(
				"Duplicate page slug '{0}' under the same parent in this change request. "
				"Existing doc_key: {1} ({2})"
			).format(slug, existing.doc_key, (existing.title or "").strip() or existing.name),
			frappe.ValidationError,
		)


def _validate_no_duplicate_leaf_slugs(items: dict[str, dict[str, Any]]) -> None:
	"""Validate the final merged tree has no duplicate leaf slugs under the same parent."""
	seen: dict[tuple[str | None, str], dict[str, Any]] = {}
	dupes: dict[tuple[str | None, str], list[dict[str, Any]]] = {}

	for doc_key, item in items.items():
		if not item or item.get("is_group") or not item.get("slug"):
			continue
		key = (item.get("parent_key") or None, item.get("slug"))
		current = {"doc_key": doc_key, "title": item.get("title")}
		if key in seen:
			dupes.setdefault(key, [seen[key]]).append(current)
		else:
			seen[key] = current

	if not dupes:
		return

	lines = []
	for (parent_key, slug), rows in sorted(dupes.items(), key=lambda kv: (kv[0][0] or "", kv[0][1])):
		parts = []
		for r in rows:
			title = (r.get("title") or "").strip()
			parts.append(f"{r.get('doc_key')}{f' ({title})' if title else ''}")
		parent_label = parent_key or "<root>"
		lines.append(f"- parent_key={parent_label}, slug='{slug}': " + ", ".join(parts))

	frappe.throw(
		_(
			"Duplicate leaf slugs detected in the merged tree (these would generate duplicate routes). "
			"Resolve by renaming/moving/deleting one of the pages:\n{0}"
		).format("\n".join(lines)),
		frappe.ValidationError,
	)


def has_revision_changes(base_revision: str | None, head_revision: str | None) -> bool:
	if not base_revision or not head_revision:
		return False
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
	if existing:
		selected = None
		for row in existing:
			if has_revision_changes(row.get("base_revision"), row.get("head_revision")):
				selected = row
				break
		if not selected:
			selected = existing[0]
		cr = frappe.get_doc("Wiki Change Request", selected["name"])
		cr.check_permission("read")
		main_revision = frappe.get_value("Wiki Space", wiki_space, "main_revision")
		if main_revision and cr.base_revision and cr.base_revision != main_revision:
			frappe.db.set_value("Wiki Change Request", cr.name, "outdated", 1)
			base_hash = (
				frappe.get_value(
					"Wiki Revision",
					cr.base_revision,
					["tree_hash", "content_hash"],
					as_dict=True,
				)
				or {}
			)
			head_hash = (
				frappe.get_value(
					"Wiki Revision",
					cr.head_revision,
					["tree_hash", "content_hash"],
					as_dict=True,
				)
				or {}
			)
			if base_hash.get("tree_hash") == head_hash.get("tree_hash") and base_hash.get(
				"content_hash"
			) == head_hash.get("content_hash"):
				frappe.db.set_value(
					"Wiki Change Request",
					cr.name,
					{"status": "Archived", "archived_at": now_datetime()},
				)
				space = frappe.get_doc("Wiki Space", wiki_space)
				default_title = title or f"Draft Changes - {space.space_name}"
				new_cr = create_change_request(wiki_space, default_title)
				return new_cr.as_dict()
		return cr.as_dict()

	space = frappe.get_doc("Wiki Space", wiki_space)
	default_title = title or f"Draft Changes - {space.space_name}"
	cr = create_change_request(wiki_space, default_title)
	return cr.as_dict()


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
	if not root_group:
		return {"children": [], "root_group": None}

	root_key = frappe.get_value("Wiki Document", root_group, "doc_key")
	items = frappe.get_all(
		"Wiki Revision Item",
		fields=[
			"doc_key",
			"title",
			"slug",
			"is_group",
			"is_published",
			"is_external_link",
			"external_url",
			"parent_key",
			"order_index",
			"is_deleted",
		],
		filters={"revision": cr.head_revision},
	)

	doc_map: dict[str, dict[str, Any]] = {}
	for item in items:
		if item.get("is_deleted"):
			continue
		doc_map[item["doc_key"]] = {
			"doc_key": item.get("doc_key"),
			"document_name": None,
			"route": None,
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

	return {"children": children, "root_group": root_key}


@frappe.whitelist()
def get_cr_page(name: str, doc_key: str) -> dict[str, Any]:
	cr = frappe.get_doc("Wiki Change Request", name)
	cr.check_permission("read")
	item = frappe.db.get_value(
		"Wiki Revision Item",
		{"revision": cr.head_revision, "doc_key": doc_key},
		[
			"doc_key",
			"title",
			"slug",
			"is_group",
			"is_published",
			"is_external_link",
			"external_url",
			"parent_key",
			"order_index",
			"content_blob",
			"is_deleted",
		],
		as_dict=True,
	)
	if not item or item.get("is_deleted"):
		frappe.throw(_("Document not found in change request"))

	content = ""
	if item.get("content_blob"):
		content = frappe.get_value("Wiki Content Blob", item.get("content_blob"), "content") or ""

	doc_name = frappe.db.get_value("Wiki Document", {"doc_key": doc_key}, ["name", "route"], as_dict=True)
	return {
		"doc_key": item.get("doc_key"),
		"title": item.get("title"),
		"slug": item.get("slug"),
		"is_group": item.get("is_group"),
		"is_published": item.get("is_published"),
		"is_external_link": item.get("is_external_link"),
		"external_url": item.get("external_url"),
		"parent_key": item.get("parent_key"),
		"order_index": item.get("order_index"),
		"document_name": doc_name.get("name") if doc_name else None,
		"route": doc_name.get("route") if doc_name else None,
		"content": content,
	}


@frappe.whitelist()
def create_change_request(wiki_space: str, title: str, description: str | None = None) -> Document:
	space = frappe.get_doc("Wiki Space", wiki_space)
	if not space.main_revision:
		main_revision = create_revision_from_live_tree(wiki_space, message="Initial main")
		frappe.db.set_value("Wiki Space", wiki_space, "main_revision", main_revision.name)
		space.main_revision = main_revision.name

	base_revision = space.main_revision
	head_revision = clone_revision(base_revision, is_working=1)

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
	cr = frappe.get_doc("Wiki Change Request", name)
	head_revision = cr.head_revision

	item_map = get_revision_item_map(head_revision)
	max_order = max(
		[item.get("order_index") or 0 for item in item_map.values() if item.get("parent_key") == parent_key]
		or [0]
	)

	item = frappe.new_doc("Wiki Revision Item")
	item.revision = head_revision
	item.doc_key = frappe.generate_hash(length=12)
	item.title = title
	item.slug = slug or cleanup_page_name(title)
	_validate_unique_leaf_slug_in_revision(
		head_revision,
		item.doc_key,
		parent_key,
		item.slug,
		is_group=is_group,
		is_deleted=0,
	)
	item.is_group = 1 if is_group else 0
	item.is_published = 1 if is_published else 0
	item.is_external_link = 1 if is_external_link else 0
	item.external_url = external_url
	item.parent_key = parent_key
	item.order_index = order_index if order_index is not None else max_order + 1
	item.content_blob = get_or_create_content_blob(content or "")
	item.is_deleted = 0
	item.insert()

	recompute_revision_hashes(head_revision)
	touch_change_request(cr.name)
	return item.doc_key


@frappe.whitelist()
def update_cr_page(name: str, doc_key: str, fields: dict[str, Any]) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	item_name = frappe.get_value(
		"Wiki Revision Item", {"revision": cr.head_revision, "doc_key": doc_key}, "name"
	)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	if "title" in fields and fields["title"] is not None:
		item.title = fields["title"]
	if "slug" in fields and fields["slug"] is not None:
		item.slug = fields["slug"]
	if "is_group" in fields and fields["is_group"] is not None:
		item.is_group = 1 if fields["is_group"] else 0
	if "is_published" in fields and fields["is_published"] is not None:
		item.is_published = 1 if fields["is_published"] else 0
	if "is_external_link" in fields and fields["is_external_link"] is not None:
		item.is_external_link = 1 if fields["is_external_link"] else 0
	if "external_url" in fields and fields["external_url"] is not None:
		item.external_url = fields["external_url"]
	if "content" in fields and fields["content"] is not None:
		item.content_blob = get_or_create_content_blob(fields["content"])
	if "is_deleted" in fields and fields["is_deleted"] is not None:
		item.is_deleted = 1 if fields["is_deleted"] else 0

	_validate_unique_leaf_slug_in_revision(
		cr.head_revision,
		item.doc_key,
		item.parent_key,
		item.slug,
		is_group=item.is_group,
		is_deleted=item.is_deleted,
	)
	item.save()

	recompute_revision_hashes(cr.head_revision)
	touch_change_request(cr.name)


@frappe.whitelist()
def move_cr_page(name: str, doc_key: str, new_parent_key: str, new_order_index: int | None = None) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	item_name = frappe.get_value(
		"Wiki Revision Item", {"revision": cr.head_revision, "doc_key": doc_key}, "name"
	)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	item.parent_key = new_parent_key
	_validate_unique_leaf_slug_in_revision(
		cr.head_revision,
		item.doc_key,
		item.parent_key,
		item.slug,
		is_group=item.is_group,
		is_deleted=item.is_deleted,
	)
	if new_order_index is not None:
		item.order_index = new_order_index
	item.save()

	recompute_revision_hashes(cr.head_revision)
	touch_change_request(cr.name)


@frappe.whitelist()
def reorder_cr_children(name: str, parent_key: str, ordered_doc_keys: list[str]) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	for index, doc_key in enumerate(ordered_doc_keys):
		item_name = frappe.get_value(
			"Wiki Revision Item",
			{"revision": cr.head_revision, "doc_key": doc_key, "parent_key": parent_key},
			"name",
		)
		if not item_name:
			continue
		frappe.db.set_value("Wiki Revision Item", item_name, "order_index", index)

	recompute_revision_hashes(cr.head_revision)
	touch_change_request(cr.name)


@frappe.whitelist()
def delete_cr_page(name: str, doc_key: str) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	item_name = frappe.get_value(
		"Wiki Revision Item", {"revision": cr.head_revision, "doc_key": doc_key}, "name"
	)
	if not item_name:
		frappe.throw(_("Document not found in change request"))

	item = frappe.get_doc("Wiki Revision Item", item_name)
	item.is_deleted = 1
	item.save()

	items = frappe.get_all(
		"Wiki Revision Item",
		fields=["name", "doc_key", "parent_key"],
		filters={"revision": cr.head_revision},
	)
	children: dict[str | None, list[dict[str, str]]] = {}
	for row in items:
		children.setdefault(row.get("parent_key"), []).append(row)

	to_visit = [doc_key]
	seen = {doc_key}
	while to_visit:
		current = to_visit.pop()
		for child in children.get(current, []):
			child_key = child.get("doc_key")
			if not child_key or child_key in seen:
				continue
			seen.add(child_key)
			frappe.db.set_value("Wiki Revision Item", child.get("name"), "is_deleted", 1)
			to_visit.append(child_key)

	recompute_revision_hashes(cr.head_revision)
	touch_change_request(cr.name)


@frappe.whitelist()
def diff_change_request(name: str, scope: str = "summary", doc_key: str | None = None):
	cr = frappe.get_doc("Wiki Change Request", name)
	base_items = get_revision_item_map(cr.base_revision)
	head_items = get_revision_item_map(cr.head_revision)
	base_contents: dict[str, str] = {}
	head_contents: dict[str, str] = {}

	def normalize(item: dict[str, Any] | None, content: str | None = None) -> dict[str, Any] | None:
		if not item or item.get("is_deleted"):
			return None
		result = {
			"title": item.get("title"),
			"slug": item.get("slug"),
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
		return {"doc_key": doc_key, "base": base, "head": head}

	changes = []
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
			order_changed = base.get("order_index") != head.get("order_index")
			metadata_fields = ["title", "slug", "is_group", "is_published", "parent_key"]
			metadata_changed = any(base.get(field) != head.get(field) for field in metadata_fields)
			content_changed = base.get("content_hash") != head.get("content_hash")
			if base.get("content_hash") is None and head.get("content_hash") is None:
				base_blob = (base_items.get(key) or {}).get("content_blob")
				head_blob = (head_items.get(key) or {}).get("content_blob")
				content_changed = base_blob != head_blob
			if order_changed and not metadata_changed and not content_changed:
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
def request_review(name: str, reviewers: list[str]) -> None:
	cr = frappe.get_doc("Wiki Change Request", name)
	unique_reviewers = []
	seen = set()
	for reviewer in reviewers or []:
		if reviewer and reviewer not in seen:
			unique_reviewers.append(reviewer)
			seen.add(reviewer)

	cr.reviewers = []
	for reviewer in unique_reviewers:
		cr.append(
			"reviewers",
			{
				"reviewer": reviewer,
				"status": "Requested",
			},
		)

	cr.status = "In Review"
	cr.save()


@frappe.whitelist()
def review_action(name: str, reviewer: str, status: str, comment: str | None = None) -> None:
	if reviewer != frappe.session.user and not _is_manager_or_approver():
		frappe.throw(_("You can only submit a review as yourself."), frappe.PermissionError)

	cr = frappe.get_doc("Wiki Change Request", name)
	row = None
	for reviewer_row in cr.reviewers or []:
		if reviewer_row.reviewer == reviewer:
			row = reviewer_row
			break

	if not row:
		row = cr.append(
			"reviewers",
			{
				"reviewer": reviewer,
				"status": status,
			},
		)

	row.status = status
	row.reviewed_at = now_datetime()
	if comment is not None:
		row.comment = comment

	# recompute CR status
	approved = 0
	changes_requested = 0
	for reviewer_row in cr.reviewers or []:
		if reviewer_row.status == "Approved":
			approved += 1
		elif reviewer_row.status == "Changes Requested":
			changes_requested += 1

	if changes_requested:
		cr.status = "Changes Requested"
	elif approved and approved == len(cr.reviewers):
		cr.status = "Approved"
	else:
		cr.status = "In Review"

	cr.save()


@frappe.whitelist()
def merge_change_request(name: str) -> str:
	if not _is_manager_or_approver():
		frappe.throw(_("Only Wiki Managers or Approvers can merge change requests."), frappe.PermissionError)

	cr = frappe.get_doc("Wiki Change Request", name)
	space = frappe.get_doc("Wiki Space", cr.wiki_space)

	base_items = get_revision_item_map(cr.base_revision)
	ours_items = get_revision_item_map(space.main_revision)
	theirs_items = get_revision_item_map(cr.head_revision)
	base_contents = get_contents_for_items(base_items)
	ours_contents = get_contents_for_items(ours_items)
	theirs_contents = get_contents_for_items(theirs_items)

	conflicts = []
	merged_items: dict[str, dict[str, Any]] = {}

	all_keys = set(base_items) | set(ours_items) | set(theirs_items)

	for key in all_keys:
		base = normalize_item(base_items.get(key))
		ours = normalize_item(ours_items.get(key))
		theirs = normalize_item(theirs_items.get(key))
		base_content = base_contents.get(key, "")
		ours_content = ours_contents.get(key, "")
		theirs_content = theirs_contents.get(key, "")

		result, conflict_type = merge_items(base, ours, theirs, base_content, ours_content, theirs_content)
		if conflict_type == "content" and base and ours and theirs:
			normalized_base = normalize_merge_text(base_content)
			normalized_ours = normalize_merge_text(ours_content)
			normalized_theirs = normalize_merge_text(theirs_content)
			merged_content, line_ok = line_merge_fallback(normalized_base, normalized_ours, normalized_theirs)
			if not line_ok:
				merged_content, conflict = merge_content_linewise(
					normalized_base, normalized_ours, normalized_theirs
				)
				line_ok = not conflict
				if not line_ok:
					merged_content = merge_content_disjoint(
						normalized_base, normalized_ours, normalized_theirs
					)
					line_ok = merged_content is not None
					if not line_ok:
						merged_content, conflict = merge_content(
							normalized_base, normalized_ours, normalized_theirs
						)
						line_ok = not conflict
			if line_ok:
				merged = {
					"doc_key": ours.get("doc_key"),
					"title": resolve_field(base.get("title"), ours.get("title"), theirs.get("title")),
					"slug": resolve_field(base.get("slug"), ours.get("slug"), theirs.get("slug")),
					"is_group": resolve_field(
						base.get("is_group"), ours.get("is_group"), theirs.get("is_group")
					),
					"is_published": resolve_field(
						base.get("is_published"), ours.get("is_published"), theirs.get("is_published")
					),
					"parent_key": ours.get("parent_key"),
					"order_index": ours.get("order_index"),
				}
				merged_items[key] = with_content_blob(merged, merged_content)
				continue
		if conflict_type:
			conflicts.append(
				{"doc_key": key, "type": conflict_type, "base": base, "ours": ours, "theirs": theirs}
			)
			continue
		if result:
			merged_items[key] = result

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

		# In web requests, an exception triggers a rollback which would erase the
		# inserted conflict rows. Persist them so the UI can show details.
		if not frappe.flags.in_test:
			frappe.db.commit()

		frappe.throw(_("Merge conflicts detected"), frappe.ValidationError)

	_validate_no_duplicate_leaf_slugs(merged_items)

	merge_revision = create_merge_revision(cr, merged_items)
	apply_merge_revision(space, merge_revision)

	cr.status = "Merged"
	cr.merge_revision = merge_revision.name
	cr.merged_by = frappe.session.user
	cr.merged_at = now_datetime()
	cr.save()

	return merge_revision.name


@frappe.whitelist()
def check_outdated(name: str) -> int:
	cr = frappe.get_doc("Wiki Change Request", name)
	main_revision = frappe.get_value("Wiki Space", cr.wiki_space, "main_revision")
	outdated = 1 if main_revision and main_revision != cr.base_revision else 0
	frappe.db.set_value("Wiki Change Request", cr.name, "outdated", outdated)
	return outdated


def normalize_item(item: dict[str, Any] | None) -> dict[str, Any] | None:
	if not item or item.get("is_deleted"):
		return None
	return {
		"doc_key": item.get("doc_key"),
		"title": item.get("title"),
		"slug": item.get("slug"),
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
	merged_content, line_ok = line_merge_fallback(normalized_base, normalized_ours, normalized_theirs)
	if not line_ok:
		merged_content, conflict = merge_content_linewise(normalized_base, normalized_ours, normalized_theirs)
		if conflict:
			merged_content = merge_content_disjoint(normalized_base, normalized_ours, normalized_theirs)
			if merged_content is None:
				merged_content, conflict = merge_content(normalized_base, normalized_ours, normalized_theirs)
				if conflict:
					return None, "content"

	merged = {
		"doc_key": ours.get("doc_key"),
		"title": resolve_field(base.get("title"), ours.get("title"), theirs.get("title")),
		"slug": resolve_field(base.get("slug"), ours.get("slug"), theirs.get("slug")),
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
	compare_fields = ["title", "slug", "is_group", "is_published", "parent_key", "order_index"]
	for field in compare_fields:
		if item_a.get(field) != item_b.get(field):
			return False
	return content_a == content_b


def conflict_on_metadata(base: dict[str, Any], ours: dict[str, Any], theirs: dict[str, Any]) -> bool:
	metadata_fields = ["title", "slug", "is_group", "is_published"]
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


def merge_content(base: str, ours: str, theirs: str) -> tuple[str, bool]:
	if ours == theirs:
		return ours, False
	if ours == base:
		return theirs, False
	if theirs == base:
		return ours, False

	base_lines = base.splitlines(keepends=True)
	ours_lines = ours.splitlines(keepends=True)
	theirs_lines = theirs.splitlines(keepends=True)

	if len(base_lines) == len(ours_lines) == len(theirs_lines):
		merged_lines: list[str] = []
		for base_line, ours_line, theirs_line in zip(base_lines, ours_lines, theirs_lines, strict=False):
			if ours_line == theirs_line:
				merged_lines.append(ours_line)
			elif ours_line == base_line:
				merged_lines.append(theirs_line)
			elif theirs_line == base_line:
				merged_lines.append(ours_line)
			else:
				merged_lines = []
				break
		if merged_lines:
			return "".join(merged_lines), False

	ours_edits = diff_edits(base_lines, ours_lines)
	theirs_edits = diff_edits(base_lines, theirs_lines)

	if edits_conflict(ours_edits, theirs_edits) and not edits_disjoint(ours_edits, theirs_edits):
		return "", True

	merged_lines = apply_edits(base_lines, combine_edits(ours_edits, theirs_edits))
	return "".join(merged_lines), False


def merge_content_linewise(base: str, ours: str, theirs: str) -> tuple[str, bool]:
	base_lines = base.splitlines()
	ours_lines = ours.splitlines()
	theirs_lines = theirs.splitlines()

	ours_edits = diff_edits(base_lines, ours_lines)
	theirs_edits = diff_edits(base_lines, theirs_lines)

	if not edits_disjoint(ours_edits, theirs_edits):
		return "", True

	merged_lines = apply_edits(base_lines, combine_edits(ours_edits, theirs_edits))
	ending = "\n" if base.endswith("\n") or ours.endswith("\n") or theirs.endswith("\n") else ""
	return "\n".join(merged_lines) + ending, False


def merge_content_disjoint(base: str, ours: str, theirs: str) -> str | None:
	base_lines = base.splitlines(keepends=True)
	ours_lines = ours.splitlines(keepends=True)
	theirs_lines = theirs.splitlines(keepends=True)

	ours_edits = diff_edits(base_lines, ours_lines)
	theirs_edits = diff_edits(base_lines, theirs_lines)

	if not edits_disjoint(ours_edits, theirs_edits):
		return None

	merged_lines = apply_edits(base_lines, combine_edits(ours_edits, theirs_edits))
	return "".join(merged_lines)


def line_merge_fallback(base: str, ours: str, theirs: str) -> tuple[str, bool]:
	base_lines = base.splitlines()
	ours_lines = ours.splitlines()
	theirs_lines = theirs.splitlines()

	if len(base_lines) != len(ours_lines) or len(base_lines) != len(theirs_lines):
		return "", False

	merged: list[str] = []
	for base_line, ours_line, theirs_line in zip(base_lines, ours_lines, theirs_lines, strict=False):
		base_cmp = base_line.rstrip()
		ours_cmp = ours_line.rstrip()
		theirs_cmp = theirs_line.rstrip()
		if ours_cmp == theirs_cmp:
			merged.append(ours_line)
		elif ours_cmp == base_cmp:
			merged.append(theirs_line)
		elif theirs_cmp == base_cmp:
			merged.append(ours_line)
		else:
			return "", False

	ending = "\n" if base.endswith("\n") or ours.endswith("\n") or theirs.endswith("\n") else ""
	return "\n".join(merged) + ending, True


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


def edits_conflict(
	ours_edits: list[tuple[int, int, list[str]]],
	theirs_edits: list[tuple[int, int, list[str]]],
) -> bool:
	for i1, i2, o_lines in ours_edits:
		for j1, j2, t_lines in theirs_edits:
			if i1 == i2 and j1 == j2 and i1 == j1:
				if o_lines != t_lines:
					return True
				continue
			if ranges_overlap(i1, i2, j1, j2):
				return True
			if i1 == i2 and j1 <= i1 < j2:
				return True
			if j1 == j2 and i1 <= j1 < i2:
				return True
	return False


def ranges_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
	return max(a_start, b_start) < min(a_end, b_end)


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

	# Handle deletions: docs that exist in space but not in merge revision
	for doc_key, doc_name in list(key_to_name.items()):
		if doc_key == root_doc_key:
			continue
		if doc_key not in items:
			frappe.delete_doc("Wiki Document", doc_name, force=True)
			del key_to_name[doc_key]

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

	frappe.db.set_value("Wiki Space", space.name, "main_revision", revision.name)
