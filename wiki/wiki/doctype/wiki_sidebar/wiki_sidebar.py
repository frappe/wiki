# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document


class WikiSidebar(Document):
	def before_save(self):

		details = frappe.db.get_values(
			"Wiki Sidebar", filters={"name": self.name}, fieldname=["title"], pluck="title"
		)

		if not details:
			return

		old_title = details[0]

		if old_title != self.title:
			frappe.db.sql(
				'Update `tabWiki Sidebar Item` set title = %s where item = %s and type = "Wiki Sidebar"',
				(self.title, self.name),
			)
			self.clear_cache()

	def get_children(self):
		out = self.get_sidebar_items()
		for sidebar_item in self.sidebar_items:
			if sidebar_item.type == "Wiki Sidebar":
				sidebar = frappe.get_doc("Wiki Sidebar", sidebar_item.item)
				children = sidebar.get_children()
				out.append(
					{
						"group_title": sidebar_item.title,
						"group_items": children,
						"name": sidebar_item.name,
						"group_name": sidebar.name,
						"type": "Wiki Sidebar",
					}
				)
		return out

	def get_items(self):

		topmost = self.find_topmost(self.name)

		sidebar_html = frappe.cache().hget("wiki_sidebar", topmost)
		if not sidebar_html or frappe.conf.disable_website_cache or frappe.conf.developer_mode:
			sidebar_items = frappe.get_doc("Wiki Sidebar", topmost).get_children()
			context = frappe._dict({})
			context.sidebar_items = sidebar_items
			context.docs_search_scope = topmost
			sidebar_html = frappe.render_template(
				"wiki/wiki/doctype/wiki_page/templates/web_sidebar.html", context
			)
			frappe.cache().hset("wiki_sidebar", topmost, sidebar_html)

		return sidebar_html, topmost

	def get_sidebar_items(self):
		items_without_group = []
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={"parent": self.name, "type": "Wiki Page"},
			fields=["title", "item", "name", "type", "route"],
			order_by="idx asc",
		)

		for item in items:
			item.item = "/" + str(item.route)
			items_without_group.append(item)

		# return [{"group_title": "Topics", "group_items": items_without_group}] if items else []
		return items_without_group if items else []

	def validate(self):
		self.clear_cache()

	def on_trash(self):
		sidebar_group_name = frappe.get_value("Wiki Sidebar Item", {"title": self.name}, pluck="name")
		frappe.delete_doc("Wiki Sidebar Item", sidebar_group_name)

		# delete children of the group
		for child_doc in self.get_children():
			if child_doc["type"] == "Wiki Page":
				wiki_page_name = frappe.get_value("Wiki Page", {"route": child_doc["route"]}, pluck="name")
				frappe.delete_doc("Wiki Page", wiki_page_name)
			elif child_doc["type"] == "Wiki Sidebar":
				frappe.delete_doc("Wiki Sidebar", child_doc["group_name"])

		self.clear_cache()

	def on_update(self):
		self.clear_cache()

	def find_topmost(self, me):
		parent = frappe.db.get_value("Wiki Sidebar Item", {"item": me, "type": "Wiki Sidebar"}, "parent")
		if not parent:
			return me
		return self.find_topmost(parent)

	def clear_cache(self):
		topmost = self.find_topmost(self.name)
		frappe.cache().hdel("wiki_sidebar", topmost)

	def clone(self, original, new):
		items = frappe.get_all(
			"Wiki Sidebar Item",
			filters={
				"parent": self.name,
			},
			fields=[
				"title",
				"item",
				"name",
				"type",
				"route",
				"modified",
				"modified_by",
				"creation",
				"owner",
			],
			order_by="idx asc",
		)

		cloned_wiki_sidebar = frappe.new_doc("Wiki Sidebar")
		if original in self.route:
			cloned_wiki_sidebar.route = self.route.replace(original, new)
		else:
			cloned_wiki_sidebar.route = self.route + f"/{new}"
		cloned_wiki_sidebar.title = self.title

		for item in items:
			if item.type == "Wiki Sidebar":
				clone = frappe.get_doc("Wiki Sidebar", item.item).clone(original, new)
				cloned_wiki_sidebar.append(
					"sidebar_items",
					{
						"type": "Wiki Sidebar",
						"item": clone.name,
					},
				)
			else:
				clone = frappe.get_doc("Wiki Page", item.item).clone(original, new)
				cloned_wiki_sidebar.append(
					"sidebar_items",
					{
						"type": "Wiki Page",
						"item": clone.name,
					},
				)

		cloned_wiki_sidebar.save()

		return cloned_wiki_sidebar


@frappe.whitelist()
def get_sidebar_group_names():
	return frappe.db.get_list("Wiki Sidebar", filters=[["name", "!=", "wiki"]], pluck="name")


@frappe.whitelist()
def delete_sidebar_group(sidebar_group_name):
	if not frappe.has_permission(doctype="Wiki Sidebar", ptype="delete", throw=False):
		frappe.throw(
			_("You are not permitted to delete a Wiki Sidebar"),
			frappe.PermissionError,
		)

	frappe.delete_doc("Wiki Sidebar", sidebar_group_name)
	return True
