# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""One-way GitHub → Wiki sync engine.

Pulls a repo's docs folder, infers a page tree, and drives the *existing* merge
applier (`_apply_merge_changes_only`) with a target revision synthesized outside
a Change Request. The repo is the single source of truth; the wiki is read-only.

The GitHub HTTP helpers (`_fetch_*`) are module-level so tests can monkeypatch
them — the engine itself is transport-agnostic and takes an optional token so
real auth (TB4) can be slotted in without touching the merge logic.
"""

from __future__ import annotations

import base64
import re
from collections import defaultdict
from typing import Any

import frappe
import requests
from frappe import _
from frappe.utils import now_datetime
from frappe.website.utils import cleanup_page_name

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	_apply_merge_changes_only,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
	create_revision_from_live_tree,
	get_or_create_content_blob,
	get_revision_item_map,
	recompute_revision_hashes,
)

GITHUB_API = "https://api.github.com"
MARKDOWN_EXTENSIONS = (".md", ".mdx")
LANDING_BASENAMES = ("readme.md", "index.md", "readme.mdx", "index.mdx")

H1_PATTERN = re.compile(r"^#\s+(.+?)\s*#*\s*$")


# --------------------------------------------------------------------------- #
# GitHub HTTP (monkeypatched in tests)
# --------------------------------------------------------------------------- #
def _github_headers(token: str | None) -> dict[str, str]:
	headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
	if token:
		headers["Authorization"] = f"Bearer {token}"
	return headers


def _fetch_head_sha(repo: str, branch: str, token: str | None = None) -> str:
	resp = requests.get(
		f"{GITHUB_API}/repos/{repo}/git/ref/heads/{branch}",
		headers=_github_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	return resp.json()["object"]["sha"]


def _fetch_tree(repo: str, ref: str, token: str | None = None) -> list[dict[str, Any]]:
	resp = requests.get(
		f"{GITHUB_API}/repos/{repo}/git/trees/{ref}?recursive=1",
		headers=_github_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	return resp.json().get("tree", [])


def _fetch_blob(repo: str, sha: str, token: str | None = None) -> str:
	resp = requests.get(
		f"{GITHUB_API}/repos/{repo}/git/blobs/{sha}",
		headers=_github_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	data = resp.json()
	if data.get("encoding") == "base64":
		return base64.b64decode(data.get("content") or "").decode("utf-8")
	return data.get("content") or ""


# --------------------------------------------------------------------------- #
# Structure inference
# --------------------------------------------------------------------------- #
def _extract_title(content: str) -> str | None:
	for line in (content or "").splitlines():
		match = H1_PATTERN.match(line.strip())
		if match:
			return match.group(1).strip()
	return None


def _humanize(name: str) -> str:
	return name.replace("-", " ").replace("_", " ").strip().title()


def build_nodes(
	repo: str,
	tree_entries: list[dict[str, Any]],
	docs_subdir: str | None,
	token: str | None = None,
) -> tuple[list[dict[str, Any]], str | None, str | None]:
	"""Infer a page tree from a flat GitHub tree listing.

	Returns ``(nodes, root_content, root_landing_path)`` where each node is a
	dict describing a group (folder) or leaf (``.md``) page. ``README.md`` /
	``index.md`` become the *landing* content of their folder rather than a
	standalone page; the repo-root landing maps onto the space's root group.
	"""
	prefix = (docs_subdir or "").strip("/")

	md_files = []
	for entry in tree_entries:
		if entry.get("type") != "blob":
			continue
		path = entry.get("path") or ""
		if prefix:
			if not path.startswith(prefix + "/"):
				continue
			rel = path[len(prefix) + 1 :]
		else:
			rel = path
		if not rel.lower().endswith(MARKDOWN_EXTENSIONS):
			continue
		md_files.append({"path": path, "rel": rel, "sha": entry.get("sha")})

	dirs: set[str] = set()
	landings: dict[str, dict[str, Any]] = {}
	pages: list[dict[str, Any]] = []
	for f in md_files:
		parts = f["rel"].split("/")
		for i in range(1, len(parts)):
			dirs.add("/".join(parts[:i]))
		dir_rel = "/".join(parts[:-1])
		if parts[-1].lower() in LANDING_BASENAMES:
			landings[dir_rel] = f
		else:
			f["dir_rel"] = dir_rel
			pages.append(f)

	def full(rel: str) -> str:
		return f"{prefix}/{rel}" if prefix else rel

	def content_of(f: dict[str, Any]) -> str:
		return _fetch_blob(repo, f["sha"], token)

	nodes: list[dict[str, Any]] = []

	for folder in sorted(dirs):
		landing = landings.get(folder)
		content = content_of(landing) if landing else ""
		seg = folder.split("/")[-1]
		nodes.append(
			{
				"is_group": 1,
				"dir": folder,
				"parent_dir": "/".join(folder.split("/")[:-1]),
				# A group's source_path is its landing file (README.md/index.md) when
				# one exists, so "Edit on GitHub" (TB2) opens the actual editable file;
				# folders with no landing keep the directory path (nothing to edit).
				"source_path": landing["path"] if landing else full(folder),
				"landing_path": landing["path"] if landing else None,
				"title": _extract_title(content) or _humanize(seg),
				"content": content,
				"seg": seg,
			}
		)

	for f in pages:
		content = content_of(f)
		seg = f["rel"].split("/")[-1]
		nodes.append(
			{
				"is_group": 0,
				"dir": f["dir_rel"],
				"parent_dir": f["dir_rel"],
				"source_path": f["path"],
				"landing_path": None,
				"title": _extract_title(content) or _humanize(seg.rsplit(".", 1)[0]),
				"content": content,
				"seg": seg,
			}
		)

	root_landing = landings.get("")
	root_content = content_of(root_landing) if root_landing else None
	root_landing_path = root_landing["path"] if root_landing else None

	return nodes, root_content, root_landing_path


# --------------------------------------------------------------------------- #
# Apply to live tree (drives the existing merge applier)
# --------------------------------------------------------------------------- #
def _blob_content(item: dict[str, Any]) -> str:
	blob = item.get("content_blob")
	if not blob:
		return ""
	return frappe.db.get_value("Wiki Content Blob", blob, "content") or ""


def _sync_to_live(space: frappe.Document, nodes: list[dict[str, Any]], root_content: str | None) -> None:
	"""Build a target revision from inferred nodes and apply it to the live tree."""
	live_revision = create_revision_from_live_tree(
		space.name, message="git-sync: live snapshot", ignore_permissions=True
	)
	prev_items = get_revision_item_map(live_revision.name)

	root_doc_key = frappe.db.get_value("Wiki Document", space.root_group, "doc_key")
	root_prev = prev_items.get(root_doc_key)

	root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
	live_docs = frappe.get_all(
		"Wiki Document",
		fields=["name", "doc_key", "source_path"],
		filters=[["lft", ">=", root_lft], ["rgt", "<=", root_rgt]],
	)
	src_to_key = {d.source_path: d.doc_key for d in live_docs if d.source_path}

	# Stable identity: reuse the doc_key already bound to this source_path.
	group_key_by_dir: dict[str, str] = {}
	for node in nodes:
		node["doc_key"] = src_to_key.get(node["source_path"]) or frappe.generate_hash(length=12)
		if node["is_group"]:
			group_key_by_dir[node["dir"]] = node["doc_key"]

	node_by_key = {node["doc_key"]: node for node in nodes}
	for node in nodes:
		parent_dir = node["parent_dir"]
		node["parent_key"] = (
			root_doc_key if parent_dir == "" else group_key_by_dir.get(parent_dir, root_doc_key)
		)

	# Routes computed top-down so a re-sync of unchanged content is a true no-op.
	slug_for: dict[str, str] = {}
	route_for: dict[str, str] = {root_doc_key: space.route}

	def resolve_route(node: dict[str, Any]) -> str:
		key = node["doc_key"]
		if key in route_for:
			return route_for[key]
		slug = cleanup_page_name(node["title"]).replace("_", "-")
		parent_key = node["parent_key"]
		parent_route = space.route if parent_key == root_doc_key else resolve_route(node_by_key[parent_key])
		route = f"{parent_route}/{slug}"
		slug_for[key] = slug
		route_for[key] = route
		return route

	for node in nodes:
		resolve_route(node)

	siblings: dict[str, list[dict[str, Any]]] = defaultdict(list)
	for node in nodes:
		siblings[node["parent_key"]].append(node)
	for group in siblings.values():
		group.sort(key=lambda n: n["seg"].lower())
		for index, node in enumerate(group):
			node["sort_order"] = index

	target = frappe.new_doc("Wiki Revision")
	target.wiki_space = space.name
	target.message = "git-sync: repo snapshot"
	target.is_merge = 1
	target.is_working = 0
	target.created_by = frappe.session.user
	target.created_at = now_datetime()
	target.insert(ignore_permissions=True)

	def add_item(doc_key, title, slug, route, is_group, is_published, parent_key, order_index, content):
		item = frappe.new_doc("Wiki Revision Item")
		item.revision = target.name
		item.doc_key = doc_key
		item.title = title
		item.slug = slug
		item.route = route
		item.is_group = is_group
		item.is_published = is_published
		item.is_external_link = 0
		item.parent_key = parent_key
		item.order_index = order_index or 0
		item.content_blob = get_or_create_content_blob(content or "")
		item.is_deleted = 0
		item.insert(ignore_permissions=True)

	# Root group is mirrored unchanged unless the repo root carries a landing file.
	if root_prev:
		add_item(
			root_doc_key,
			root_prev.get("title"),
			root_prev.get("slug"),
			root_prev.get("route"),
			1,
			root_prev.get("is_published"),
			None,
			root_prev.get("order_index"),
			root_content if root_content is not None else _blob_content(root_prev),
		)

	for node in nodes:
		key = node["doc_key"]
		add_item(
			key,
			node["title"],
			slug_for[key],
			route_for[key],
			node["is_group"],
			1,
			node["parent_key"],
			node["sort_order"],
			node["content"],
		)

	recompute_revision_hashes(target.name)

	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_changes_only(space, target, prev_items)
	finally:
		frappe.flags.in_apply_merge_revision = False

	# Wiki Revision Item carries no source_path, so stamp it back onto live docs.
	for node in nodes:
		name = frappe.db.get_value("Wiki Document", {"doc_key": node["doc_key"]}, "name")
		if name:
			frappe.db.set_value(
				"Wiki Document", name, "source_path", node["source_path"], update_modified=False
			)


# --------------------------------------------------------------------------- #
# Entry point (enqueued by Wiki Space.sync_now)
# --------------------------------------------------------------------------- #
def sync_space(space_name: str, token: str | None = None) -> None:
	"""Sync one git-synced Wiki Space from its GitHub repo. Safe to enqueue."""
	space = frappe.get_doc("Wiki Space", space_name)
	if not space.git_synced:
		return
	if not space.repo_full_name or not space.branch:
		_record_error(space_name, _("Repository and branch are required for git sync."))
		return

	frappe.db.set_value("Wiki Space", space_name, "last_sync_status", "Running", update_modified=False)

	try:
		head_sha = _fetch_head_sha(space.repo_full_name, space.branch, token)
		if head_sha and head_sha == space.last_synced_commit_sha:
			_record_success(space_name, head_sha)
			return

		tree = _fetch_tree(space.repo_full_name, head_sha, token)
		nodes, root_content, _root_landing = build_nodes(space.repo_full_name, tree, space.docs_subdir, token)
		_sync_to_live(space, nodes, root_content)
		_record_success(space_name, head_sha)
	except Exception:
		# Error visibility is enough for the walking skeleton; TB5 adds a proper
		# sync log and partial-failure rollback.
		frappe.log_error(title=f"Wiki Git Sync failed: {space_name}")
		_record_error(space_name, frappe.get_traceback(with_context=False))


def _record_success(space_name: str, commit_sha: str) -> None:
	frappe.db.set_value(
		"Wiki Space",
		space_name,
		{
			"last_sync_status": "Success",
			"last_synced_commit_sha": commit_sha,
			"last_sync_time": now_datetime(),
			"last_sync_error": None,
		},
		update_modified=False,
	)


def _record_error(space_name: str, error: str) -> None:
	frappe.db.set_value(
		"Wiki Space",
		space_name,
		{
			"last_sync_status": "Error",
			"last_sync_time": now_datetime(),
			"last_sync_error": (error or "")[:5000],
		},
		update_modified=False,
	)
