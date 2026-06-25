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
import json
import posixpath
import re
from collections import defaultdict
from typing import Any

import frappe
import requests
import yaml
from frappe import _
from frappe.utils import now_datetime
from frappe.website.utils import cleanup_page_name

from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	_apply_merge_changes_only,
	_classify_changes,
	_find_changed_keys,
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
WIKI_CONFIG_PATH = ".wiki.json"
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".avif")

H1_PATTERN = re.compile(r"^#\s+(.+?)\s*#*\s*$")
# Leading YAML front matter: "---" on the very first line (optional BOM), the
# YAML body, then a closing "---" or "..." line. Non-greedy so it stops at the
# first closing delimiter; a "---" thematic break later in the body is untouched.
FRONT_MATTER_PATTERN = re.compile(r"^﻿?---[ \t]*\r?\n(.*?)\r?\n(?:---|\.\.\.)[ \t]*\r?\n?", re.DOTALL)
# Markdown image: ![alt](src "optional title"). Groups: 1=prefix "![alt](",
# 2=src (optionally <>-wrapped), 3=optional title, 4=closing ")".
MD_IMAGE_PATTERN = re.compile(r"(!\[[^\]]*\]\(\s*)(<[^>]+>|[^)\s]+)(\s+[^)]*)?(\))")


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


def _fetch_blob_bytes(repo: str, sha: str, token: str | None = None) -> bytes:
	"""Fetch a raw (binary) blob — for images, which must not be utf-8 decoded."""
	resp = requests.get(
		f"{GITHUB_API}/repos/{repo}/git/blobs/{sha}",
		headers=_github_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	data = resp.json()
	if data.get("encoding") == "base64":
		return base64.b64decode(data.get("content") or "")
	return (data.get("content") or "").encode("utf-8")


# --------------------------------------------------------------------------- #
# Repo image import (→ Frappe File, optional WebP, rewritten links)
# --------------------------------------------------------------------------- #
def _is_repo_relative_image(src: str) -> bool:
	"""True only for a repo-relative image src we should import.

	External URLs (``http(s)://``, protocol-relative), ``data:`` URIs, in-page
	anchors, and already-stored ``/files/`` URLs are left untouched.
	"""
	if not src:
		return False
	low = src.lower()
	if low.startswith(("http://", "https://", "//", "data:", "mailto:", "/files/", "/private/files/", "#")):
		return False
	return "://" not in src


def _import_repo_image(
	space: frappe.Document, repo_path: str, sha: str, repo: str, token: str | None = None
) -> str | None:
	"""Import one repo image as a Frappe File, returning its ``/files/…`` URL.

	Idempotent per (space, blob SHA): the File is named ``gitimg-<sha>.<ext>`` and
	attached to the Wiki Space, so an unchanged image SHA reuses the existing File
	(no re-upload, no content churn). WebP conversion runs when the setting is on.
	"""
	ext = ("." + repo_path.rsplit(".", 1)[1].lower()) if "." in repo_path else ""
	stem = f"gitimg-{sha}"
	existing = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": "Wiki Space",
			"attached_to_name": space.name,
			"file_name": ["like", f"{stem}.%"],
		},
		fields=["file_url"],
		limit=1,
	)
	if existing:
		return existing[0].file_url

	image_bytes = _fetch_blob_bytes(repo, sha, token)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{stem}{ext}",
			"attached_to_doctype": "Wiki Space",
			"attached_to_name": space.name,
			"is_private": 0,
			"content": image_bytes,
		}
	).insert(ignore_permissions=True)

	from wiki.api import CONVERTIBLE_IMAGE_EXTENSIONS, convert_file_to_webp

	if ext in CONVERTIBLE_IMAGE_EXTENSIONS and frappe.get_cached_value(
		"Wiki Settings", "Wiki Settings", "auto_convert_images_to_webp"
	):
		return convert_file_to_webp(file_doc) or file_doc.file_url
	return file_doc.file_url


def _rewrite_image_links(
	content: str,
	source_path: str,
	repo: str,
	sha_by_path: dict[str, str],
	space: frappe.Document | None,
	token: str | None = None,
) -> str:
	"""Rewrite repo-relative Markdown image links to imported ``/files/…`` URLs.

	Each ``![alt](src)`` whose ``src`` resolves (relative to the source file's
	directory) to an image blob in the repo tree is imported and the link
	rewritten in place — *before* the content is hashed into a blob, so the
	deduped blob already carries final, stable URLs. ``space=None`` (pure
	inference, no sync target) is a no-op.
	"""
	if not content or not space or not source_path:
		return content

	base_dir = posixpath.dirname(source_path)

	def repl(match: re.Match) -> str:
		raw = match.group(2)
		src = raw.strip("<>").strip()
		if not _is_repo_relative_image(src):
			return match.group(0)
		resolved = posixpath.normpath(posixpath.join(base_dir, src))
		# A "../" that climbs above the repo root can't be in the tree.
		if resolved.startswith("..") or not resolved.lower().endswith(IMAGE_EXTENSIONS):
			return match.group(0)
		blob_sha = sha_by_path.get(resolved)
		if not blob_sha:
			return match.group(0)
		url = _import_repo_image(space, resolved, blob_sha, repo, token)
		if not url:
			return match.group(0)
		return f"{match.group(1)}{url}{match.group(3) or ''}{match.group(4)}"

	return MD_IMAGE_PATTERN.sub(repl, content)


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


def strip_front_matter(raw: str) -> tuple[str, dict[str, Any]]:
	"""Split a leading YAML front matter block off the Markdown body.

	Returns ``(body, meta)``. Docs repos (Docusaurus/Hugo/Jekyll/mkdocs) prefix
	files with a ``---``-delimited YAML block that otherwise renders as a stray
	setext heading. Malformed front matter (unparseable YAML or a non-mapping
	result — e.g. a leading ``---`` that's really a thematic break) is left
	**intact**: ``(raw, {})`` — surface the odd file rather than eat content.
	"""
	if not raw:
		return raw, {}
	match = FRONT_MATTER_PATTERN.match(raw)
	if not match:
		return raw, {}
	try:
		meta = yaml.safe_load(match.group(1))
	except yaml.YAMLError:
		return raw, {}
	if not isinstance(meta, dict):
		return raw, {}
	return raw[match.end() :], meta


def _front_matter_title(meta: dict[str, Any]) -> str | None:
	"""The front matter ``title`` when it's a usable scalar, else ``None``."""
	title = meta.get("title")
	# bool is an int subclass; a YAML `true` title is meaningless here.
	if isinstance(title, str | int | float) and not isinstance(title, bool):
		return str(title).strip() or None
	return None


def build_nodes(
	repo: str,
	tree_entries: list[dict[str, Any]],
	docs_subdir: str | None,
	token: str | None = None,
	space: frappe.Document | None = None,
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
		# Skip dot-directories/files (.github, .vscode, …) — repo plumbing such as
		# issue/PR templates and workflows is never wiki content.
		if any(seg.startswith(".") for seg in rel.split("/")):
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

	sha_by_path = {e.get("path"): e.get("sha") for e in tree_entries if e.get("type") == "blob"}

	def full(rel: str) -> str:
		return f"{prefix}/{rel}" if prefix else rel

	def content_of(f: dict[str, Any]) -> tuple[str, str | None]:
		"""Return ``(body, front_matter_title)`` — body stripped of front matter and image-rewritten."""
		body, meta = strip_front_matter(_fetch_blob(repo, f["sha"], token))
		body = _rewrite_image_links(body, f["path"], repo, sha_by_path, space, token)
		return body, _front_matter_title(meta)

	nodes: list[dict[str, Any]] = []

	for folder in sorted(dirs):
		landing = landings.get(folder)
		content, fm_title = content_of(landing) if landing else ("", None)
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
				# Title precedence: front-matter title → first H1 → humanized name.
				"title": fm_title or _extract_title(content) or _humanize(seg),
				# Slug from the (unique) path segment, not the title — two pages
				# sharing an H1 would otherwise collide on route.
				"slug": seg,
				"content": content,
				"seg": seg,
			}
		)

	for f in pages:
		content, fm_title = content_of(f)
		seg = f["rel"].split("/")[-1]
		nodes.append(
			{
				"is_group": 0,
				"dir": f["dir_rel"],
				"parent_dir": f["dir_rel"],
				"source_path": f["path"],
				"landing_path": None,
				"title": fm_title or _extract_title(content) or _humanize(seg.rsplit(".", 1)[0]),
				"slug": seg.rsplit(".", 1)[0],
				"content": content,
				"seg": seg,
			}
		)

	root_landing = landings.get("")
	# Root group keeps its own title (from the live snapshot); only its body matters here.
	root_content = content_of(root_landing)[0] if root_landing else None
	root_landing_path = root_landing["path"] if root_landing else None

	return nodes, root_content, root_landing_path


# --------------------------------------------------------------------------- #
# .wiki.json structure override
# --------------------------------------------------------------------------- #
def load_wiki_config(
	repo: str, tree_entries: list[dict[str, Any]], token: str | None = None
) -> dict[str, Any] | None:
	"""Return the parsed ``.wiki.json`` from the repo root, or ``None`` if absent.

	A malformed config is surfaced (raises) rather than silently ignored, so the
	sync records a clear error instead of falling back to inference unexpectedly.
	"""
	sha = next(
		(e.get("sha") for e in tree_entries if e.get("type") == "blob" and e.get("path") == WIKI_CONFIG_PATH),
		None,
	)
	if not sha:
		return None
	raw = _fetch_blob(repo, sha, token)
	try:
		config = json.loads(raw or "{}")
	except json.JSONDecodeError as exc:
		frappe.throw(_("Invalid {0}: {1}").format(WIKI_CONFIG_PATH, str(exc)))
	if not isinstance(config, dict):
		frappe.throw(_("{0} must be a JSON object.").format(WIKI_CONFIG_PATH))
	return config


def build_nodes_from_config(
	repo: str,
	tree_entries: list[dict[str, Any]],
	config: dict[str, Any],
	docs_subdir: str | None = None,
	token: str | None = None,
	space: frappe.Document | None = None,
) -> tuple[list[dict[str, Any]], str | None, str | None]:
	"""Drive structure from an explicit ``.wiki.json`` ``nav`` instead of inference.

	``nav`` is an ordered list of single-key dicts: ``{"Title": "path.md"}`` is a
	leaf page, ``{"Title": [ ...children... ]}`` is a group. Paths resolve under
	``docs_dir`` (config) or the space's ``docs_subdir``. Hierarchy, order, and
	titles all come from the config; page bodies still come from the repo files.

	Only files referenced in ``nav`` are synced; anything else in the repo is
	ignored (the config is treated as authoritative). A nav entry whose file is
	missing from the tree is skipped.
	"""
	docs_dir = (config.get("docs_dir") or docs_subdir or "").strip("/")
	nav = config.get("nav") or []
	sha_by_path = {e.get("path"): e.get("sha") for e in tree_entries if e.get("type") == "blob"}

	def full(rel: str) -> str:
		rel = (rel or "").strip("/")
		return f"{docs_dir}/{rel}" if docs_dir else rel

	nodes: list[dict[str, Any]] = []
	# A monotonic counter rendered as a zero-padded seg: the existing alphabetical
	# sibling sort in _sync_to_live then reproduces nav (document) order for free.
	order = [0]

	def next_seg() -> str:
		seg = f"{order[0]:06d}"
		order[0] += 1
		return seg

	def walk(entries: list[Any], parent_dir: str) -> None:
		if not isinstance(entries, list):
			return
		for entry in entries:
			if not isinstance(entry, dict):
				continue
			for title, value in entry.items():
				seg = next_seg()
				if isinstance(value, list):
					dir_key = f"{parent_dir}/{title}" if parent_dir else title
					nodes.append(
						{
							"is_group": 1,
							"dir": dir_key,
							"parent_dir": parent_dir,
							# No file backs a nav group, so its identity is the (stable)
							# nav title-chain; it carries no editable source.
							"source_path": f"{WIKI_CONFIG_PATH}#{dir_key}",
							"landing_path": None,
							"title": title,
							"content": "",
							"seg": seg,
						}
					)
					walk(value, dir_key)
				else:
					path = full(value)
					blob_sha = sha_by_path.get(path)
					if not blob_sha:
						continue
					# Nav title is authoritative here, but the body is still stripped.
					body, _meta = strip_front_matter(_fetch_blob(repo, blob_sha, token))
					nodes.append(
						{
							"is_group": 0,
							"dir": parent_dir,
							"parent_dir": parent_dir,
							"source_path": path,
							"landing_path": None,
							"title": title,
							"content": _rewrite_image_links(body, path, repo, sha_by_path, space, token),
							"seg": seg,
						}
					)

	walk(nav, "")
	return nodes, None, None


# --------------------------------------------------------------------------- #
# Apply to live tree (drives the existing merge applier)
# --------------------------------------------------------------------------- #
def _blob_content(item: dict[str, Any]) -> str:
	blob = item.get("content_blob")
	if not blob:
		return ""
	return frappe.db.get_value("Wiki Content Blob", blob, "content") or ""


def _sync_to_live(
	space: frappe.Document, nodes: list[dict[str, Any]], root_content: str | None
) -> dict[str, int]:
	"""Build a target revision from inferred nodes and apply it to the live tree.

	Returns the change counts (``created``/``updated``/``deleted``/``moved``) the
	apply produced, so the caller can record them on the sync log.
	"""
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
	used_routes: set[str] = {space.route}

	def resolve_route(node: dict[str, Any]) -> str:
		key = node["doc_key"]
		if key in route_for:
			return route_for[key]
		slug = cleanup_page_name(node.get("slug") or node["title"]).replace("_", "-") or "page"
		parent_key = node["parent_key"]
		parent_route = space.route if parent_key == root_doc_key else resolve_route(node_by_key[parent_key])
		# Guarantee a unique route: deduplicate with a numeric suffix so one
		# collision (same slug under a parent) can't fail the whole sync.
		base = f"{parent_route}/{slug}"
		route, n = base, 2
		while route in used_routes:
			route = f"{base}-{n}"
			n += 1
		used_routes.add(route)
		slug_for[key] = slug
		route_for[key] = route
		return route

	# Stable order (by source_path) → suffix assignment is reproducible across syncs.
	for node in sorted(nodes, key=lambda n: n["source_path"]):
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

	counts = _diff_counts(prev_items, get_revision_item_map(target.name))

	frappe.flags.in_apply_merge_revision = True
	try:
		_apply_merge_changes_only(space, target, prev_items)
	finally:
		frappe.flags.in_apply_merge_revision = False

	# Wiki Revision Item carries no source_path, so stamp it back onto live docs.
	# Resolve every doc_key → name in one query rather than one lookup per node.
	key_to_name = {
		d.doc_key: d.name
		for d in frappe.get_all(
			"Wiki Document",
			filters={"doc_key": ["in", [node["doc_key"] for node in nodes]]},
			fields=["name", "doc_key"],
		)
	}
	for node in nodes:
		name = key_to_name.get(node["doc_key"])
		if name:
			frappe.db.set_value(
				"Wiki Document", name, "source_path", node["source_path"], update_modified=False
			)

	return counts


def _diff_counts(
	prev_items: dict[str, dict[str, Any]], new_items: dict[str, dict[str, Any]]
) -> dict[str, int]:
	"""Classify the prev→target delta into created/updated/deleted/moved counts.

	Reuses the merge applier's own classification so the numbers match what it
	actually applies. A re-parented page (changed ``parent_key``) is a *move*; any
	other structural or content edit is an *update*.
	"""
	changed = _find_changed_keys(prev_items, new_items)
	content_only, structural, added, deleted = _classify_changes(prev_items, new_items, changed)
	moved = {
		k for k in structural if (prev_items.get(k) or {}).get("parent_key") != new_items[k].get("parent_key")
	}
	return {
		"created": len(added),
		"updated": len(content_only) + len(structural) - len(moved),
		"deleted": len(deleted),
		"moved": len(moved),
	}


# --------------------------------------------------------------------------- #
# Entry point (enqueued by Wiki Space.sync_now)
# --------------------------------------------------------------------------- #
def sync_space(space_name: str, token: str | None = None, trigger: str = "Manual") -> None:
	"""Sync one git-synced Wiki Space from its GitHub repo. Safe to enqueue.

	``trigger`` records what kicked the run (``Manual`` button vs ``Webhook`` push)
	so the sync log surfaces real-time delivery.
	"""
	space = frappe.get_doc("Wiki Space", space_name)
	if not space.git_synced:
		return

	log_name = _start_sync_log(space_name, trigger)

	if not space.repo_full_name or not space.branch:
		message = _("Repository and branch are required for git sync.")
		_record_error(space_name, message)
		_finalize_sync_log(log_name, "Error", error=message)
		return

	frappe.db.set_value("Wiki Space", space_name, "last_sync_status", "Running", update_modified=False)

	try:
		# Private repos: mint a short-lived installation token on demand (never stored).
		if token is None and space.github_installation_id:
			from wiki.api.github import installation_access_token

			token = installation_access_token(space.github_installation_id)

		head_sha = _fetch_head_sha(space.repo_full_name, space.branch, token)
		if head_sha and head_sha == space.last_synced_commit_sha:
			_record_success(space_name, head_sha)
			_finalize_sync_log(log_name, "No Change", commit_sha=head_sha)
			return

		tree = _fetch_tree(space.repo_full_name, head_sha, token)
		config = load_wiki_config(space.repo_full_name, tree, token)
		if config and config.get("nav"):
			nodes, root_content, _root_landing = build_nodes_from_config(
				space.repo_full_name, tree, config, space.docs_subdir, token, space=space
			)
		else:
			nodes, root_content, _root_landing = build_nodes(
				space.repo_full_name, tree, space.docs_subdir, token, space=space
			)
		counts = _sync_to_live(space, nodes, root_content)
		_record_success(space_name, head_sha)
		_finalize_sync_log(log_name, "Success", commit_sha=head_sha, counts=counts)
	except Exception:
		# Error visibility is enough for the walking skeleton; partial-failure
		# rollback is still deferred.
		frappe.log_error(title=f"Wiki Git Sync failed: {space_name}")
		error = frappe.get_traceback(with_context=False)
		_record_error(space_name, error)
		_finalize_sync_log(log_name, "Error", error=error)


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


# --------------------------------------------------------------------------- #
# Sync log (one row per run, observable in the Git Sync panel)
# --------------------------------------------------------------------------- #
def _start_sync_log(space_name: str, trigger: str = "Manual") -> str:
	log = frappe.new_doc("Wiki Git Sync Log")
	log.wiki_space = space_name
	log.status = "Running"
	log.trigger = trigger
	log.started_at = now_datetime()
	log.insert(ignore_permissions=True)
	return log.name


def _finalize_sync_log(
	log_name: str,
	status: str,
	commit_sha: str | None = None,
	counts: dict[str, int] | None = None,
	error: str | None = None,
) -> None:
	counts = counts or {}
	frappe.db.set_value(
		"Wiki Git Sync Log",
		log_name,
		{
			"status": status,
			"finished_at": now_datetime(),
			"commit_sha": commit_sha,
			"created_count": counts.get("created", 0),
			"updated_count": counts.get("updated", 0),
			"deleted_count": counts.get("deleted", 0),
			"moved_count": counts.get("moved", 0),
			"error": (error or "")[:5000] or None,
		},
		update_modified=False,
	)
