# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Backfill the role-based access control schema for Wiki Spaces.

1. Denormalize ``wiki_space`` onto every Wiki Document that lives inside a
   space's nested-set range.
2. Translate the legacy per-page ``is_private`` guest flag into per-space role
   rows so previously-public pages stay reachable:
     - any non-private published doc -> add a ``Guest`` Read row (public)
     - published docs but all private -> add an ``All`` Read row (login required)
     - no published docs            -> leave empty (open to logged-in users)

The ``is_private`` column is read via raw SQL: the field has been removed from
the DocType meta, but Frappe never drops the underlying column, so the legacy
data is still present on upgraded sites. Fresh installs never had the column,
hence the ``has_column`` guard.
"""

import frappe


def execute():
	frappe.reload_doc("wiki", "doctype", "wiki_space_role")
	frappe.reload_doc("wiki", "doctype", "wiki_space")
	frappe.reload_doc("frappe_wiki", "doctype", "wiki_document")

	has_is_private = frappe.db.has_column("Wiki Document", "is_private")

	spaces = frappe.get_all("Wiki Space", fields=["name", "root_group"])
	for space in spaces:
		if not space.root_group:
			continue

		bounds = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"], as_dict=True)
		if not bounds or bounds.lft is None:
			continue

		# 1. Denormalize wiki_space across the whole subtree.
		wiki_document = frappe.qb.DocType("Wiki Document")
		(
			frappe.qb.update(wiki_document)
			.set(wiki_document.wiki_space, space.name)
			.where((wiki_document.lft >= bounds.lft) & (wiki_document.rgt <= bounds.rgt))
		).run()

		# 2. Guest-flag migration — only seed spaces an admin hasn't configured.
		if not has_is_private:
			continue
		if frappe.db.exists("Wiki Space Role", {"parent": space.name}):
			continue

		stats = frappe.db.sql(
			"""
			SELECT
				SUM(CASE WHEN is_published = 1 AND is_private = 0 THEN 1 ELSE 0 END) AS public_published,
				SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) AS total_published
			FROM `tabWiki Document`
			WHERE lft >= %(lft)s AND rgt <= %(rgt)s
			""",
			{"lft": bounds.lft, "rgt": bounds.rgt},
			as_dict=True,
		)[0]

		public_published = stats.public_published or 0
		total_published = stats.total_published or 0

		if total_published == 0:
			continue  # no content -> leave open to logged-in users
		role = "Guest" if public_published > 0 else "All"
		_add_read_role(space.name, role)

	frappe.db.commit()


def _add_read_role(space_name: str, role: str) -> None:
	"""Append a Read-level role row directly (avoids re-validating the parent)."""
	frappe.get_doc(
		{
			"doctype": "Wiki Space Role",
			"parenttype": "Wiki Space",
			"parentfield": "roles",
			"parent": space_name,
			"role": role,
			"permission_level": "Read",
			"idx": 1,
		}
	).insert(ignore_permissions=True)
