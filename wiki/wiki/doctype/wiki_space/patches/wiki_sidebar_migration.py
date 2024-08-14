# Copyright (c) 2023, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


from collections import OrderedDict

import frappe


def execute():
	wiki_settings = frappe.get_single("Wiki Settings")
	wiki_search_scope_tuple = frappe.db.sql(
		"SELECT `value` FROM `tabSingles` where `doctype` = 'Wiki Settings' AND `field` = 'wiki_search_scope'"
	)

	if wiki_search_scope_tuple:
		# get sidebar from when wiki stored sidebars in `Wiki Settings` and move to a Wiki Space
		wiki_search_scope = wiki_search_scope_tuple[0][0]

		frappe.reload_doctype("Wiki Space")
		space = frappe.new_doc("Wiki Space")
		space.route = wiki_search_scope

		for sidebar_item in frappe.get_all(
			"Wiki Group Item", fields=["name", "wiki_page", "parent_label"], order_by="idx asc"
		):
			space.append(
				"wiki_sidebars",
				{
					"wiki_page": sidebar_item.wiki_page,
					"parent_label": sidebar_item.parent_label,
				},
			)
			frappe.db.delete("Wiki Group Item", sidebar_item.name)
		space.insert()

		frappe.reload_doctype("Wiki Settings")
		wiki_settings.default_wiki_space = wiki_search_scope
		wiki_settings.save()

	elif hasattr(wiki_settings, "sidebar"):
		# get sidebar from legacy version of wiki
		if not (all_sidebars := frappe.db.get_all("Wiki Sidebar", pluck="name", order_by="creation asc")):
			return

		# find all root sidebars
		sidebars_with_parents = frappe.db.get_all(
			"Wiki Sidebar Item",
			filters=[["type", "=", "Wiki Sidebar"]],
			pluck="item",
			order_by="creation asc",
		)

		topmosts = set(all_sidebars) - set(sidebars_with_parents)

		frappe.reload_doctype("Wiki Sidebar")

		for topmost in topmosts:
			frappe.reload_doctype("Wiki Space")
			space = frappe.new_doc("Wiki Space")
			space.route = topmost

			sidebar_items = get_children(frappe.get_doc("Wiki Sidebar", topmost))
			sidebars = get_sidebar_for_patch(sidebar_items, topmost)

			# store sidebars in wiki settings
			sidebar_items = sidebars.items()
			for sidebar, items in sidebar_items:
				for item in items:
					if item.type == "Wiki Page" and frappe.db.exists("Wiki Page", item.item):
						wiki_sidebar_dict = {
							"wiki_page": item.item,
							"parent_label": item.group_name,
						}
						space.append("wiki_sidebars", wiki_sidebar_dict)

					# delete old sidebar groups
					frappe.db.delete("Wiki Sidebar", sidebar)

			if space.wiki_sidebars:
				space.insert()
				wiki_settings.default_wiki_space = topmost

		wiki_settings.save()


def find_topmost(me):
	parent = frappe.db.get_value("Wiki Sidebar Item", {"item": me, "type": "Wiki Sidebar"}, "parent")
	if not parent:
		return me
	return find_topmost(parent)


def get_sidebar_for_patch(sidebar_items, group_name):
	sidebar_item = OrderedDict({group_name: []})

	for item in sidebar_items:
		if not item.get("group_title"):
			sidebar_item[group_name].append(item)
		else:
			for group, children in get_sidebar_for_patch(
				item.get("group_items"), item.get("group_name")
			).items():
				sidebar_item[group] = children

	return sidebar_item


def get_children(doc):
	out = get_sidebar_items(doc)

	for idx, sidebar_item in enumerate(out):
		if sidebar_item.type == "Wiki Sidebar" and frappe.db.exists("Wiki Sidebar", sidebar_item.item):
			sidebar = frappe.get_doc("Wiki Sidebar", sidebar_item.item)
			children = get_children(sidebar)
			out[idx] = {
				"group_title": sidebar_item.title,
				"group_items": children,
				"name": sidebar_item.item,
				"group_name": sidebar.name,
				"type": "Wiki Sidebar",
				"item": f"/{sidebar.route}",
			}

	return out


def get_sidebar_items(doc):
	items_without_group = []
	items = frappe.get_all(
		"Wiki Sidebar Item",
		filters={"parent": doc.name},
		fields=["title", "item", "name", "type", "route", "parent"],
		order_by="idx asc",
	)
	for item in items:
		item.group_name = frappe.get_doc("Wiki Sidebar", item.parent).title
		items_without_group.append(item)

	return items_without_group


def get_root_parent_title(name, last_parent=""):
	if parent := frappe.db.get_value("Wiki Sidebar Item", {"item": name, "type": "Wiki Sidebar"}, "parent"):
		return get_root_parent_title(parent, name)
	else:
		if last_parent:
			return last_parent
		return name
