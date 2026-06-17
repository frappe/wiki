# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Make every existing Wiki Space's read access explicit, derived from its
``is_published`` flag.

A space with no role rows still means "open to all logged-in users" in the
backend (kept as a safety fallback), but we now seed explicit rows so the
Permissions table reflects reality:

  - published space   -> ``Guest`` Read (public)
  - unpublished space -> ``All`` Read (logged-in only)

``frappe.get_roles()`` returns ``Guest`` for every user -- anonymous *and*
logged-in -- so a ``Guest`` Read row makes a space readable by everyone; only
the anonymous Guest user lacks the ``All`` role, so ``All`` Read means
"logged-in only". This matches the convention seeded by the earlier
``backfill_space_access`` patch. Managers (``System Manager`` /
``Wiki Manager``) bypass these rows entirely, so no manager row is seeded.

Spaces that already have role rows -- admin-configured or seeded by the earlier
``backfill_space_access`` patch -- are left untouched.
"""

import frappe


def execute():
	frappe.reload_doc("wiki", "doctype", "wiki_space_role")
	frappe.reload_doc("wiki", "doctype", "wiki_space")

	for space in frappe.get_all("Wiki Space", fields=["name", "is_published"]):
		if frappe.db.exists("Wiki Space Role", {"parent": space.name, "parenttype": "Wiki Space"}):
			continue

		role = "Guest" if space.is_published else "All"
		_add_read_role(space.name, role, 1)

	frappe.db.commit()


def _add_read_role(space_name: str, role: str, idx: int) -> None:
	"""Append a Read-level role row directly (avoids re-validating the parent)."""
	frappe.get_doc(
		{
			"doctype": "Wiki Space Role",
			"parenttype": "Wiki Space",
			"parentfield": "roles",
			"parent": space_name,
			"role": role,
			"permission_level": "Read",
			"idx": idx,
		}
	).insert(ignore_permissions=True)
