"""Rename Wiki Spaces whose route collides with the /wiki editor SPA namespace.

Before the reserved-route guard was introduced, a space could be created at
route="wiki", making all its public pages unreachable (the SPA handler intercepts
every /wiki/* request). This patch detects those spaces and moves them to a
non-conflicting route, cascading the rename to all child Wiki Documents.
"""

import frappe
from frappe.utils.nestedset import get_descendants_of

from wiki.wiki.doctype.wiki_space.wiki_space import RESERVED_ROUTE, is_reserved_route


def execute():
	spaces = frappe.get_all("Wiki Space", fields=["name", "route", "root_group"])
	affected = [s for s in spaces if is_reserved_route(s.route)]
	if not affected:
		return

	taken = set(frappe.get_all("Wiki Space", pluck="route", limit=0))

	for space in affected:
		old_route = space.route
		new_route = _pick_safe_route(old_route, taken)
		taken.add(new_route)

		if space.root_group and frappe.db.exists("Wiki Document", space.root_group):
			descendants = get_descendants_of("Wiki Document", space.root_group, ignore_permissions=True)
			all_docs = [space.root_group, *descendants]
			space_doc = frappe.get_doc("Wiki Space", space.name)
			space_doc._batch_update_document_routes(all_docs, old_route, new_route)

		frappe.db.set_value("Wiki Space", space.name, "route", new_route, update_modified=False)
		frappe.logger("wiki").warning(
			f"rename_reserved_wiki_routes: space {space.name!r} route {old_route!r} → {new_route!r}"
		)
		frappe.db.commit()


def _pick_safe_route(old_route: str, taken: set) -> str:
	# If old route was "wiki/foo", prefer "foo" as the new root
	suffix = old_route[len(RESERVED_ROUTE) :].lstrip("/")
	candidates = [suffix, "docs"] if suffix else ["docs"]

	for base in candidates:
		if base and base not in taken:
			return base

	# Both the suffix and "docs" are taken — append an integer suffix
	i = 2
	while True:
		candidate = f"docs-{i}"
		if candidate not in taken:
			return candidate
		i += 1
