"""Convert existing open Change Requests to the overlay revision model.

For each open CR (Draft / In Review / Changes Requested):
1. Compare head_revision items against base_revision items
2. Delete identical items from head_revision
3. Set is_overlay=1 on head_revision
"""

import frappe


def execute():
	open_crs = frappe.get_all(
		"Wiki Change Request",
		filters={"status": ("in", ["Draft", "In Review", "Changes Requested"])},
		fields=["name", "base_revision", "head_revision"],
	)

	compare_fields = [
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
	]

	for cr in open_crs:
		if not cr.base_revision or not cr.head_revision:
			continue

		# Already converted
		if frappe.db.get_value("Wiki Revision", cr.head_revision, "is_overlay"):
			continue

		base_items = {}
		for item in frappe.get_all(
			"Wiki Revision Item",
			filters={"revision": cr.base_revision},
			fields=["doc_key", *compare_fields],
		):
			base_items[item["doc_key"]] = item

		head_items = frappe.get_all(
			"Wiki Revision Item",
			filters={"revision": cr.head_revision},
			fields=["name", "doc_key", *compare_fields],
		)

		identical_names = []
		for item in head_items:
			base = base_items.get(item["doc_key"])
			if not base:
				continue  # New item in CR, keep in overlay
			if all(item.get(f) == base.get(f) for f in compare_fields):
				identical_names.append(item["name"])

		if identical_names:
			frappe.db.delete("Wiki Revision Item", {"name": ("in", identical_names)})

		frappe.db.set_value(
			"Wiki Revision",
			cr.head_revision,
			{
				"is_overlay": 1,
				"parent_revision": cr.base_revision,
				"hashes_stale": 0,
			},
		)

	frappe.db.commit()
