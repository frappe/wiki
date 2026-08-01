# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Role-based access control for Wiki Spaces.

Read access  -> view a space + its pages and raise Change Requests.
Write access -> additionally merge Change Requests. Write implies Read.

A space with no role rows is open to all logged-in users (backward compatible).
``System Manager``, ``Wiki Manager`` and ``Admin`` always have full access.

Anonymous (``Guest``) access is never granted, regardless of space role
configuration -- every hook entry point in this module rejects Guest outright.

``Owner Only`` is a layered restriction on top of the above: when a Wiki
Document's or its Wiki Space's ``owner_only`` flag is set, the record is
additionally hidden from everyone except its owner and ``Admin``-role users
(see ``_document_owner_only_blocks`` / ``_space_owner_only_blocks``).
"""

import frappe
from frappe import _

MANAGER_ROLES = {"System Manager", "Wiki Manager", "Admin"}
WRITE_PTYPES = {"write", "create", "delete", "submit", "cancel", "amend"}


def is_git_synced_space(space) -> bool:
	"""True if the space mirrors a GitHub repo (content is read-only in the wiki)."""
	name = _resolve_space_name(space)
	if not name:
		return False
	return bool(frappe.get_cached_value("Wiki Space", name, "git_synced"))


def assert_space_writable(space) -> None:
	"""Block content mutations on a git-synced space (the repo is the source of truth).

	The sync engine itself bypasses this by running under
	``frappe.flags.in_apply_merge_revision``.
	"""
	if frappe.flags.in_apply_merge_revision:
		return
	if is_git_synced_space(space):
		frappe.throw(
			_("This wiki space is synced from GitHub and is read-only."),
			frappe.PermissionError,
		)


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------


def _is_manager(user=None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	return bool(MANAGER_ROLES & set(frappe.get_roles(user)))


def _resolve_space_name(space):
	if not space:
		return None
	if isinstance(space, str):
		return space
	return space.name


def _space_role_levels(space) -> dict:
	"""Return ``{role: permission_level}`` for a space. Empty dict means open access.

	When a role appears with both levels, ``Write`` wins (it implies Read).
	"""
	name = _resolve_space_name(space)
	if not name:
		return {}

	rows = frappe.get_all(
		"Wiki Space Role",
		filters={"parent": name, "parenttype": "Wiki Space"},
		fields=["role", "permission_level"],
	)

	levels = {}
	for row in rows:
		if levels.get(row.role) == "Write":
			continue
		levels[row.role] = row.permission_level
	return levels


def _user_roles(user=None) -> set:
	return set(frappe.get_roles(user or frappe.session.user))


def _space_owner_only_blocks(space, user=None) -> bool:
	"""True if the space's own Owner Only flag hides it from `user`."""
	user = user or frappe.session.user
	name = _resolve_space_name(space)
	if not name:
		return False
	values = frappe.get_cached_value("Wiki Space", name, ["owner_only", "owner"])
	if not values:
		return False
	owner_only, space_owner = values
	if not owner_only:
		return False
	if user == space_owner:
		return False
	return "Admin" not in _user_roles(user)


def _document_owner_only_blocks(doc, user=None) -> bool:
	"""True if the document's own Owner Only flag hides it from `user`.

	Only consults the document's own field -- space-level blocking is handled
	separately (_space_owner_only_blocks) so the two OR together.
	"""
	user = user or frappe.session.user
	owner_only = doc.get("owner_only") if hasattr(doc, "get") else None
	if not owner_only:
		return False
	doc_owner = doc.get("owner") if hasattr(doc, "get") else None
	if user == doc_owner:
		return False
	return "Admin" not in _user_roles(user)


def can_read_space(space, user=None) -> bool:
	user = user or frappe.session.user
	if user == "Guest":
		return False
	if _is_manager(user):
		return True
	if _space_owner_only_blocks(space, user):
		return False

	levels = _space_role_levels(space)
	if not levels:
		# Open space: every logged-in user.
		return True

	# Any role row (Read or Write) grants read.
	return bool(set(frappe.get_roles(user)) & set(levels))


def can_write_space(space, user=None) -> bool:
	user = user or frappe.session.user
	if user == "Guest":
		return False
	if _is_manager(user):
		return True
	if _space_owner_only_blocks(space, user):
		return False

	levels = _space_role_levels(space)
	if not levels:
		# Open space: writers are the global Wiki Approvers.
		return "Wiki Approver" in frappe.get_roles(user)

	user_roles = set(frappe.get_roles(user))
	return any(role in user_roles for role, level in levels.items() if level == "Write")


def _space_accepts_contributions(space) -> bool:
	"""Whether a space lets Read-tier users propose changes (raise CRs).

	Missing/NULL is treated as enabled so spaces created before this toggle (and
	rows not yet backfilled) keep accepting contributions.
	"""
	name = _resolve_space_name(space)
	if not name:
		return True
	value = frappe.get_cached_value("Wiki Space", name, "allow_contributions")
	return value is None or bool(value)


def can_contribute_to_space(space, user=None) -> bool:
	"""Whether the user may propose changes (raise/edit Change Requests).

	Write-tier users (and managers) can always contribute. Read-tier users can
	contribute only while the space accepts contributions.
	"""
	user = user or frappe.session.user
	if not can_read_space(space, user):
		return False
	if can_write_space(space, user):
		return True
	return _space_accepts_contributions(space)


def can_manage_tabs(space, user=None) -> bool:
	"""Whether the user may create or promote/demote tabs in a space.

	Deliberately stricter than `can_contribute_to_space`: a tab restructures the
	top-level navigation for every reader of the space, which is an editor
	decision rather than a contribution.
	"""
	return can_write_space(space, user)


def assert_can_manage_tabs(space, user=None) -> None:
	if not can_manage_tabs(space, user):
		frappe.throw(
			_("Only space editors can create or change tabs."),
			frappe.PermissionError,
		)


def _accessible_space_names(user=None) -> set:
	"""Spaces a user may read: open spaces (no role rows) plus restricted spaces
	with a role row whose role the user holds. Guests get nothing."""
	user = user or frappe.session.user
	if user == "Guest":
		return set()

	user_roles = set(frappe.get_roles(user))

	rows = frappe.get_all(
		"Wiki Space Role",
		filters={"parenttype": "Wiki Space"},
		fields=["parent", "role"],
	)
	restricted_spaces = {row.parent for row in rows}
	accessible_restricted = {row.parent for row in rows if row.role in user_roles}

	all_spaces = set(frappe.get_all("Wiki Space", pluck="name"))
	open_spaces = all_spaces - restricted_spaces
	result = open_spaces | accessible_restricted

	if "Admin" not in user_roles:
		owner_only_spaces = frappe.get_all(
			"Wiki Space", filters={"owner_only": 1}, fields=["name", "owner"]
		)
		blocked = {row.name for row in owner_only_spaces if row.owner != user}
		result -= blocked

	return result


def _space_in_clause(table: str, user: str, allow_null: bool) -> str:
	"""Build a WHERE fragment restricting ``table`` to spaces the user can read."""
	if user == "Guest":
		allow_null = False
	names = _accessible_space_names(user)
	parts = []
	if allow_null:
		parts.append(f"`{table}`.`wiki_space` is null")
	if names:
		escaped = ", ".join(frappe.db.escape(name) for name in names)
		parts.append(f"`{table}`.`wiki_space` in ({escaped})")

	if not parts:
		return "1=0"
	if len(parts) == 1:
		return parts[0]
	return "(" + " or ".join(parts) + ")"


# ---------------------------------------------------------------------------
# Hook entry points
# ---------------------------------------------------------------------------


def wiki_space_query_conditions(user=None, doctype=None):
	user = user or frappe.session.user
	if user == "Guest":
		return "1=0"
	if _is_manager(user):
		return ""

	names = _accessible_space_names(user)
	if not names:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in names)
	return f"`tabWiki Space`.`name` in ({escaped})"


def wiki_space_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
	if user == "Guest":
		return False
	if ptype in WRITE_PTYPES:
		return can_write_space(doc, user)
	return can_read_space(doc, user)


def wiki_document_query_conditions(user=None, doctype=None):
	user = user or frappe.session.user
	if user == "Guest":
		return "1=0"
	if _is_manager(user):
		return ""

	space_clause = _space_in_clause("tabWiki Document", user, allow_null=True)
	if "Admin" in _user_roles(user):
		return space_clause

	escaped_user = frappe.db.escape(user)
	owner_only_clause = (
		f"(`tabWiki Document`.`owner_only` = 0 "
		f"or `tabWiki Document`.`owner_only` is null "
		f"or `tabWiki Document`.`owner` = {escaped_user})"
	)
	return f"({space_clause}) and ({owner_only_clause})"


def wiki_document_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
	if user == "Guest":
		return False
	if _document_owner_only_blocks(doc, user) and not _is_manager(user):
		return False

	space = doc.wiki_space
	if not space:
		# Orphan document: readable by all, writable only by managers.
		if ptype in WRITE_PTYPES:
			return _is_manager(user)
		return True

	if ptype in WRITE_PTYPES:
		# A git-synced space is read-only; only the sync engine (running under
		# in_apply_merge_revision) may write its documents.
		if not frappe.flags.in_apply_merge_revision and is_git_synced_space(space):
			return False
		return can_write_space(space, user)
	return can_read_space(space, user)


def wiki_cr_query_conditions(user=None, doctype=None):
	user = user or frappe.session.user
	if user == "Guest":
		return "1=0"
	if _is_manager(user):
		return ""
	return _space_in_clause("tabWiki Change Request", user, allow_null=True)


def wiki_cr_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
	if user == "Guest":
		return False
	space = doc.wiki_space
	if not space:
		if ptype in WRITE_PTYPES:
			return _is_manager(user)
		return True

	# Reading a CR requires space Read. Editing/saving it (proposing changes)
	# additionally requires the space to accept contributions (Write-tier users
	# bypass that). Merging is gated separately by can_write_space in the CR
	# controller.
	if ptype in WRITE_PTYPES:
		return can_contribute_to_space(space, user)
	return can_read_space(space, user)
