# Copyright (c) 2023, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe


def execute():
	navbar_items = frappe.get_single("Website Settings").top_bar_items

	for navbar_item in navbar_items:
		wiki_nav_item = frappe.new_doc("Top Bar Item")
		wiki_nav_item_dict = {
			"label": navbar_item.label,
			"parent_label": navbar_item.parent_label,
			"url": navbar_item.url,
			"parent": "Wiki Settings",
			"parenttype": "Wiki Settings",
			"parentfield": "navbar",
			"idx": navbar_item.idx,
		}
		wiki_nav_item.update(wiki_nav_item_dict)
		wiki_nav_item.save()
