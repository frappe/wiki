import frappe
from frappe import _
from frappe.utils.nestedset import get_descendants_of


@frappe.whitelist()
def get_space_roles(space_id: str) -> list[dict]:
	"""Return the configured access-control role rows for a Wiki Space."""
	space = frappe.get_cached_doc("Wiki Space", space_id)
	space.check_permission("read")
	return [{"role": row.role, "permission_level": row.permission_level} for row in space.roles]


@frappe.whitelist()
def update_space_roles(space_id: str, roles: list | str) -> list[dict]:
	"""Replace a Wiki Space's access-control role rows.

	Restricted to users who can write the space (managers, or Write-tier users
	of a configured space).
	"""
	if isinstance(roles, str):
		roles = frappe.parse_json(roles)

	space = frappe.get_doc("Wiki Space", space_id)
	space.check_permission("write")

	space.set("roles", [])
	for row in roles or []:
		role = (row.get("role") or "").strip()
		if not role:
			continue
		space.append(
			"roles",
			{"role": role, "permission_level": row.get("permission_level") or "Read"},
		)
	space.save()
	return [{"role": row.role, "permission_level": row.permission_level} for row in space.roles]


@frappe.whitelist()
def set_space_contributions(space_id: str, allow: int | str | bool) -> bool:
	"""Toggle whether a Wiki Space accepts contributions (Change Requests).

	Restricted to users who can write the space (managers, or Write-tier users of
	a configured space), mirroring access-control changes. Rejected on git-synced
	spaces, which are read-only — contributions can't happen there regardless.
	"""
	from wiki.permissions import assert_space_writable

	allow = frappe.parse_json(allow) if isinstance(allow, str) else allow
	value = 1 if allow else 0

	space = frappe.get_doc("Wiki Space", space_id)
	space.check_permission("write")
	assert_space_writable(space)
	space.allow_contributions = value
	space.save()
	return bool(value)


OPEN_ROLES = {"Guest", "All"}


@frappe.whitelist()
def get_restricted_spaces(spaces: list[str]) -> list[str]:
	"""Return which of `spaces` are readable only by specific roles.

	A space with no role rows is open to every logged-in user, and so is one
	whose rows include `All`. One whose rows include `Guest` is public
	(``frappe.get_roles()`` returns Guest for anonymous requests and All for
	every logged-in user) -- see `wiki.permissions.can_read_space`. Everything
	else is restricted, which is what the sidebar's lock icon means.

	One grouped query rather than a role list per row: the sidebar pages 50
	spaces at a time, and the child table is only ever read for this flag.

	Uses `get_list` on Wiki Space first, so spaces the user cannot read are
	dropped before their role rows are looked at.
	"""
	if not spaces:
		return []

	visible = {
		row.name for row in frappe.get_list("Wiki Space", filters={"name": ["in", spaces]}, fields=["name"])
	}
	if not visible:
		return []

	rows = frappe.get_all(
		"Wiki Space Role",
		filters={"parenttype": "Wiki Space", "parent": ["in", list(visible)]},
		fields=["parent", "role"],
	)

	roles_by_space = {}
	for row in rows:
		roles_by_space.setdefault(row.parent, set()).add(row.role)

	return sorted(name for name, roles in roles_by_space.items() if not roles & OPEN_ROLES)


# What the Change Requests page calls "All in review". A Draft is one author's
# private work in progress -- it is waiting on nobody, and counting it made a
# space with nothing to review report two.
#
# An inclusion list rather than an exclusion one: a status added later should
# have to be named here to be counted, not slip in because it is absent from a
# list of the ones that are finished.
IN_REVIEW_CHANGE_REQUEST_STATUSES = ["In Review", "Approved"]


@frappe.whitelist()
def get_space_stats(spaces: list[str]) -> dict:
	"""Directory figures for `spaces`: pages and change requests awaiting review.

	Two grouped queries for a whole page of spaces rather than two per row,
	behind the same `get_list` gate as `get_restricted_spaces` -- a space the
	user cannot read is dropped before it is counted, so the figures never leak
	the size of a restricted space.

	Last activity is deliberately not here. `Wiki Space.last_edited` already
	carries it, stamped on every save, delete and content-only merge, and the
	directory both sorts and renders from that one field -- so the column can
	never disagree with the order it is shown in.
	"""
	from frappe.query_builder.functions import Count

	if not spaces:
		return {}

	visible = [
		row.name for row in frappe.get_list("Wiki Space", filters={"name": ["in", spaces]}, fields=["name"])
	]
	if not visible:
		return {}

	stats = {name: {"pages": 0, "change_requests_in_review": 0} for name in visible}

	# Groups and external links are navigation, not pages, so neither is counted.
	document = frappe.qb.DocType("Wiki Document")
	document_rows = (
		frappe.qb.from_(document)
		.select(document.wiki_space, Count(document.name).as_("pages"))
		.where(
			document.wiki_space.isin(visible) & (document.is_group == 0) & (document.is_external_link == 0)
		)
		.groupby(document.wiki_space)
	).run(as_dict=True)
	for row in document_rows:
		stats[row.wiki_space]["pages"] = row.pages

	change_request = frappe.qb.DocType("Wiki Change Request")
	change_request_rows = (
		frappe.qb.from_(change_request)
		.select(change_request.wiki_space, Count(change_request.name).as_("change_requests_in_review"))
		.where(
			change_request.wiki_space.isin(visible)
			& change_request.status.isin(IN_REVIEW_CHANGE_REQUEST_STATUSES)
		)
		.groupby(change_request.wiki_space)
	).run(as_dict=True)
	for row in change_request_rows:
		stats[row.wiki_space]["change_requests_in_review"] = row.change_requests_in_review

	return stats


@frappe.whitelist(methods=["POST"])
def get_space_bootstrap(space_id: str) -> dict:
	"""The space, the user's capabilities in it and, if they may edit, their draft change request.

	The tree stays a separate request: the editor opens without it, and a failed tree load can be
	retried on its own. POST because it may create the draft.
	"""
	from frappe.client import get as get_doc_for_client

	from wiki.api import get_space_capabilities
	from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
		get_or_create_draft_change_request,
	)

	doc = get_doc_for_client("Wiki Space", space_id)
	capabilities = get_space_capabilities(space_id)
	bootstrap = {"doc": doc, "capabilities": capabilities, "change_request": None}
	if capabilities["can_contribute"] and not doc.get("git_synced"):
		bootstrap["change_request"] = get_or_create_draft_change_request(space_id)
	return bootstrap


@frappe.whitelist()
def get_wiki_tree(space_id: str) -> dict:
	"""Get the tree structure of Wiki Documents for a given Wiki Space."""
	space = frappe.get_cached_doc("Wiki Space", space_id)
	space.check_permission("read")

	if not space.root_group:
		return {"children": [], "root_group": None}

	from wiki.frappe_wiki.doctype.wiki_document.wiki_document import WIKI_FULL_TREE_CACHE_KEY

	root_group = space.root_group
	tree = frappe.cache().hget(WIKI_FULL_TREE_CACHE_KEY, root_group)
	if tree is None:
		descendants = get_descendants_of("Wiki Document", root_group, ignore_permissions=True)
		tree = _build_wiki_tree_for_api(descendants) if descendants else []
		frappe.cache().hset(WIKI_FULL_TREE_CACHE_KEY, root_group, tree)
	return {"children": tree, "root_group": root_group}


def _build_wiki_tree_for_api(documents: list[str]) -> list[dict]:
	"""Build a nested tree structure from a list of Wiki Document names."""
	wiki_documents = frappe.db.get_all(
		"Wiki Document",
		fields=[
			"name",
			"title",
			"is_group",
			"parent_wiki_document",
			"route",
			"is_published",
			"sort_order",
		],
		filters={"name": ("in", documents)},
		order_by="lft asc",
	)

	doc_map = {doc["name"]: {**doc, "label": doc["title"], "children": []} for doc in wiki_documents}

	root_nodes = []
	for doc in wiki_documents:
		parent_name = doc["parent_wiki_document"]
		if parent_name and parent_name in doc_map:
			doc_map[parent_name]["children"].append(doc_map[doc["name"]])
		else:
			root_nodes.append(doc_map[doc["name"]])

	# Sort children by sort_order at each level (lft is used for tree structure, sort_order for display)
	def sort_children(nodes):
		nodes.sort(key=lambda x: (x.get("sort_order") or 0, x["name"]))
		for node in nodes:
			if node["children"]:
				sort_children(node["children"])

	sort_children(root_nodes)

	return root_nodes


@frappe.whitelist()
def reorder_wiki_documents(
	doc_name: str,
	new_parent: str | None,
	new_index: int,
	siblings: str,
):
	"""
	Reorder a Wiki Document by changing its parent and/or position among siblings.

	Args:
			doc_name: The name of the document being moved
			new_parent: The new parent document name (can be None for root level)
			new_index: The new index position among siblings
			siblings: JSON string of sibling document names in the new order

	Returns:
			dict with is_contribution: False for direct reorders
	"""
	import json

	from wiki.permissions import assert_space_writable

	siblings_list = json.loads(siblings) if isinstance(siblings, str) else siblings

	doc = frappe.get_doc("Wiki Document", doc_name)

	old_space = _get_wiki_space_for_document(doc.name)
	assert_space_writable(old_space)

	# Check if user has write permission
	if not frappe.has_permission("Wiki Document", "write", doc=doc):
		frappe.throw(_("You do not have permission to reorder this document"))

	# Merges lock the space before its pages, so take locks in the same order.
	if old_space:
		lock_wiki_space(old_space)

	# Direct reorder for users with write permission
	parent_changed = doc.parent_wiki_document != new_parent

	frappe.flags.in_reorder_wiki_documents = True
	try:
		if parent_changed:
			move_wiki_document(doc, new_parent)

		# Batch update sort_order for all siblings
		_batch_update_sort_order(siblings_list)

		if parent_changed:
			# A move can change the owning space; re-stamp the moved subtree.
			from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
				stamp_wiki_space_subtree,
			)

			stamp_wiki_space_subtree(doc_name)
	finally:
		frappe.flags.in_reorder_wiki_documents = False

	from wiki.frappe_wiki.doctype.wiki_document.wiki_document import clear_wiki_tree_cache

	new_space = _get_wiki_space_for_document(doc.name)
	# Reorders bypass on_update (raw sort_order writes), so bust the tree cache here.
	clear_wiki_tree_cache(old_space, new_space)

	_sync_main_revision_for_space(new_space)

	return {"is_contribution": False}


def move_wiki_document(doc, new_parent: str | None) -> None:
	from frappe.utils.nestedset import update_move_node

	doc.parent_wiki_document = new_parent
	update_move_node(doc, "parent_wiki_document")
	frappe.db.set_value(
		"Wiki Document",
		doc.name,
		{"parent_wiki_document": new_parent, "old_parent": new_parent},
	)


def _batch_update_sort_order(siblings: list[str]) -> None:
	"""Batch update sort_order for siblings in a single query."""
	# Filter out temp items (drafts) - they don't exist in the database
	valid_siblings = [(idx, name) for idx, name in enumerate(siblings) if not name.startswith("temp_")]

	if not valid_siblings:
		return

	# Build a single UPDATE query with CASE WHEN
	case_parts = []
	names = []
	for idx, name in valid_siblings:
		case_parts.append(f"WHEN %s THEN {idx}")
		names.append(name)

	if not names:
		return

	case_sql = " ".join(case_parts)
	placeholders = ", ".join(["%s"] * len(names))

	frappe.db.sql(
		f"""
		UPDATE `tabWiki Document`
		SET sort_order = CASE name {case_sql} END
		WHERE name IN ({placeholders})
		""",
		tuple(names + names),
	)


def _get_wiki_space_for_document(doc_name: str) -> str | None:
	"""Get the wiki space that contains this document."""
	# Walk up the tree to find a document that's a root_group for a space
	current = doc_name
	visited = set()

	while current and current not in visited:
		visited.add(current)

		# Check if this document is the root_group of any space
		space = frappe.db.get_value("Wiki Space", {"root_group": current}, "name")
		if space:
			return space

		# Move up to parent
		current = frappe.db.get_value("Wiki Document", current, "parent_wiki_document")

	return None


def _pending_revision_spaces() -> set[str]:
	if not hasattr(frappe.local, "wiki_pending_revision_spaces"):
		frappe.local.wiki_pending_revision_spaces = set()
	return frappe.local.wiki_pending_revision_spaces


def queue_main_revision_sync(space_name: str | None) -> None:
	"""Defer a space's revision snapshot to the end of the transaction.

	`create_revision_from_live_tree` re-materialises every document in the space, so
	snapshotting inline on each save makes a bulk write cost O(n^2) item inserts.
	Collapsing to one snapshot per transaction keeps it linear. Readers of
	`main_revision` call `flush_pending_revision_syncs` first, so a deferred sync is
	never observable to them.
	"""
	if not space_name:
		return

	pending = _pending_revision_spaces()
	if not pending:
		frappe.db.before_commit.add(flush_pending_revision_syncs)
		frappe.db.after_rollback.add(pending.clear)
	pending.add(space_name)


def flush_pending_revision_syncs() -> None:
	"""Snapshot every space with edits queued since the last flush.

	A space queued earlier in the transaction can be deleted before the flush runs,
	so a snapshot is only taken for one that still exists.
	"""
	pending = _pending_revision_spaces()
	while pending:
		space_name = pending.pop()
		if frappe.db.exists("Wiki Space", space_name):
			_sync_main_revision_for_space(space_name)


def lock_wiki_space(space_name: str):
	"""Lock a Wiki Space before moving `main_revision`.

	After a lock wait, plain reads still use the old snapshot, so refuse rather
	than build on it.
	"""
	space = frappe.get_doc("Wiki Space", space_name, for_update=True)
	if frappe.db.get_value("Wiki Space", space_name, "main_revision") != space.main_revision:
		frappe.throw(
			_("Another change was just published to this space. Please try again."),
			frappe.TimestampMismatchError,
		)
	return space


def _sync_main_revision_for_space(space_name: str | None) -> None:
	"""Refresh main_revision after direct edits to keep CRs aligned with live tree."""
	if not space_name:
		return

	from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import (
		create_revision_from_live_tree,
	)

	space = lock_wiki_space(space_name)
	revision = create_revision_from_live_tree(
		space.name,
		message="Direct reorder",
		parent_revision=space.main_revision,
	)
	frappe.db.set_value("Wiki Space", space.name, "main_revision", revision.name)
