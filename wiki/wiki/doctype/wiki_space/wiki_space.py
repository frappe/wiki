# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt
import json

import frappe
import pymysql
from frappe.model.document import Document

from wiki.wiki.doctype.wiki_page.search import build_index_in_background, drop_index


class WikiSpace(Document):
	def before_insert(self):
		# insert a new wiki page when sidebar is empty
		if not self.wiki_sidebars:
			wiki_page = frappe.get_doc(
				{
					"doctype": "Wiki Page",
					"title": "New Wiki Page",
					"route": f"{self.route}/new-wiki-page",
					"published": 1,
					"content": f"Welcome to Wiki Space {self.route}",
				}
			)
			wiki_page.insert()

			self.append(
				"wiki_sidebars",
				{
					"wiki_page": wiki_page.name,
					"parent_label": "New Group",
				},
			)

	def before_save(self):
		self.update_wiki_page_routes()

	def update_wiki_page_routes(self):
		# prepend space route to the route of wiki page
		old_route = frappe.db.get_value("Wiki Space", self.name, "route")
		if not old_route or self.route == old_route:
			return

		for i, wiki_sidebar in enumerate(self.wiki_sidebars):
			wiki_page = frappe.get_value("Wiki Page", wiki_sidebar.wiki_page, ["name", "route"], as_dict=1)
			wiki_page_route = wiki_page.route.replace(old_route, self.route, 1)

			frappe.publish_progress(
				percent=i * 100 / len(self.wiki_sidebars),
				title=f"Updating Wiki Page routes - <b>{self.route}</b>",
				description=f"{i}/{len(self.wiki_sidebars)}",
			)

			try:
				if wiki_page_route:
					frappe.db.set_value(
						"Wiki Page",
						wiki_sidebar.wiki_page,
						"route",
						wiki_page_route,
					)
			except Exception as e:
				if isinstance(e, pymysql.err.IntegrityError):
					frappe.throw(f"Wiki Page with route <b>{wiki_page.route}</b> already exists.")
				else:
					raise e

	def on_update(self):
		build_index_in_background()

		# clear sidebar cache
		frappe.cache().hdel("wiki_sidebar", self.name)

	def on_trash(self):
		drop_index()

		# clear sidebar cache
		frappe.cache().hdel("wiki_sidebar", self.name)
		build_index_in_background()

	@frappe.whitelist()
	def clone_wiki_space_in_background(self, new_space_route):
		frappe.enqueue(
			clone_wiki_space,
			name=self.name,
			route=self.route,
			new_space_route=new_space_route,
			queue="long",
		)


def clone_wiki_space(name, route, new_space_route):
	if frappe.db.exists("Wiki Space", new_space_route):
		frappe.throw(f"Wiki Space <b>{new_space_route}</b> already exists.")

	items = frappe.get_all(
		"Wiki Group Item",
		filters={"parent": name},
		fields=["wiki_page", "parent_label"],
		order_by="idx asc",
	)

	cloned_wiki_space = frappe.new_doc("Wiki Space")
	cloned_wiki_space.route = new_space_route

	for idx, item in enumerate(items, 1):
		frappe.publish_progress(
			idx * 100 / len(items),
			title=f"Cloning into new Wiki Space <b>{new_space_route}</b>",
			description=f"{idx}/{len(items)}",
		)
		cloned_doc = frappe.get_doc("Wiki Page", item.wiki_page).clone(route, new_space_route)
		cloned_wiki_space.append(
			"wiki_sidebars",
			{
				"wiki_page": cloned_doc.name,
				"parent_label": item.parent_label,
			},
		)

	cloned_wiki_space.insert()

	return cloned_wiki_space


@frappe.whitelist()
def update_sidebar(sidebar_items):
	sidebars = json.loads(sidebar_items)

	sidebar_items = sidebars.items()
	if sidebar_items:
		idx = 0
		for sidebar, items in sidebar_items:
			for item in items:
				idx += 1
				frappe.db.set_value(
					"Wiki Group Item", {"wiki_page": str(item["name"])}, {"parent_label": sidebar, "idx": idx}
				)

	for key in frappe.cache().hgetall("wiki_sidebar").keys():
		frappe.cache().hdel("wiki_sidebar", key)
