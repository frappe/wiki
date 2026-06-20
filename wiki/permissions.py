# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Role-based access control for Wiki Spaces.

Read access  -> view a space + its pages and raise Change Requests.
Write access -> additionally merge Change Requests. Write implies Read.

A space with no role rows is open to all logged-in users (backward compatible).
A space whose Read list contains the built-in ``Guest`` role is publicly readable
(``frappe.get_roles()`` returns ``Guest`` for anonymous requests). ``System Manager``
and ``Wiki Manager`` always have full access.
"""

import frappe
from frappe import _

MANAGER_ROLES = {"System Manager", "Wiki Manager"}
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


def can_read_space(space, user=None) -> bool:
	user = user or frappe.session.user
	if _is_manager(user):
		return True

	levels = _space_role_levels(space)
	if not levels:
		# Open space: every logged-in user, but not anonymous Guests.
		return user != "Guest"

	# Any role row (Read or Write) grants read. Guest/All rows behave naturally
	# because frappe.get_roles() returns them in the appropriate contexts.
	return bool(set(frappe.get_roles(user)) & set(levels))


def can_write_space(space, user=None) -> bool:
	user = user or frappe.session.user
	if _is_manager(user):
		return True

	levels = _space_role_levels(space)
	if not levels:
		# Open space: writers are the global Wiki Approvers.
		return "Wiki Approver" in frappe.get_roles(user)

	user_roles = set(frappe.get_roles(user))
	return any(role in user_roles for role, level in levels.items() if level == "Write")


def _accessible_space_names(user=None) -> set:
	"""Spaces a user may read: open spaces (no role rows) plus restricted spaces
	with a role row whose role the user holds. Guests get only the latter."""
	user = user or frappe.session.user
	user_roles = set(frappe.get_roles(user))

	rows = frappe.get_all(
		"Wiki Space Role",
		filters={"parenttype": "Wiki Space"},
		fields=["parent", "role"],
	)
	restricted_spaces = {row.parent for row in rows}
	accessible_restricted = {row.parent for row in rows if row.role in user_roles}

	if user == "Guest":
		return accessible_restricted

	all_spaces = set(frappe.get_all("Wiki Space", pluck="name"))
	open_spaces = all_spaces - restricted_spaces
	return open_spaces | accessible_restricted


def _space_in_clause(table: str, user: str, allow_null: bool) -> str:
	"""Build a WHERE fragment restricting ``table`` to spaces the user can read."""
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
	if _is_manager(user):
		return ""

	names = _accessible_space_names(user)
	if not names:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in names)
	return f"`tabWiki Space`.`name` in ({escaped})"


def wiki_space_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
	if ptype in WRITE_PTYPES:
		return can_write_space(doc, user)
	return can_read_space(doc, user)


def wiki_document_query_conditions(user=None, doctype=None):
	user = user or frappe.session.user
	if _is_manager(user):
		return ""
	return _space_in_clause("tabWiki Document", user, allow_null=True)


def wiki_document_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
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
	if _is_manager(user):
		return ""
	return _space_in_clause("tabWiki Change Request", user, allow_null=True)


def wiki_cr_has_permission(doc, ptype, user=None):
	user = user or frappe.session.user
	space = doc.wiki_space
	if not space:
		if ptype in WRITE_PTYPES:
			return _is_manager(user)
		return True

	# Reading a CR and editing/saving it (proposing changes) both require space
	# Read. Merging is gated separately by can_write_space in the CR controller.
	return can_read_space(space, user)
