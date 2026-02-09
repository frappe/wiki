# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt
import frappe
from frappe import _
from frappe.model.document import Document

_CHILD_ROW_META_FIELDS = {
	"name",
	"parent",
	"parenttype",
	"parentfield",
	"idx",
	"owner",
	"creation",
	"modified",
	"modified_by",
	"docstatus",
	"doctype",
}


class WikiSpace(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF
		from frappe.website.doctype.top_bar_item.top_bar_item import TopBarItem

		from wiki.wiki.doctype.wiki_group_item.wiki_group_item import WikiGroupItem

		app_switcher_logo: DF.AttachImage | None
		dark_mode_logo: DF.AttachImage | None
		enable_feedback_collection: DF.Check
		favicon: DF.AttachImage | None
		is_published: DF.Check
		light_mode_logo: DF.AttachImage | None
		navbar_items: DF.Table[TopBarItem]
		root_group: DF.Link | None
		route: DF.Data
		show_in_switcher: DF.Check
		space_name: DF.Data | None
		switcher_order: DF.Int
		wiki_sidebars: DF.Table[WikiGroupItem]
	# end: auto-generated types

	def before_insert(self):
		self.create_root_group()

	def validate(self):
		self.remove_leading_slash_from_route()

	def remove_leading_slash_from_route(self):
		if self.route and self.route.startswith("/"):
			self.route = self.route[1 : len(self.route)]

	def create_root_group(self):
		if not self.root_group:
			root_group = frappe.get_doc(
				{
					"doctype": "Wiki Document",
					"title": f"{self.space_name} [Root Group]",
					"route": f"/{self.route}",
					"is_group": 1,
					"published": 0,
					"content": "[root_group]",
				}
			)
			root_group.insert()
			self.root_group = root_group.name

	@frappe.whitelist()
	def migrate_to_v3(self):
		if self.root_group:
			return  # Migration already done

		self.create_root_group()
		self.save()

		sidebar = self.wiki_sidebars
		if not sidebar:
			return

		groups, group_order = self._group_sidebar_items(sidebar)

		for sort_order, group_label in enumerate(group_order):
			self._create_group_with_pages(group_label, groups[group_label], sort_order)

		self.save()

	def _group_sidebar_items(self, sidebar):
		"""Group sidebar items by parent_label while maintaining order"""
		groups = {}
		group_order = []
		for item in sorted(sidebar, key=lambda x: x.idx):
			if item.parent_label not in groups:
				groups[item.parent_label] = []
				group_order.append(item.parent_label)
			groups[item.parent_label].append(item)
		return groups, group_order

	def _create_group_with_pages(self, group_label, items, sort_order):
		"""Create a group Wiki Document and its child page documents"""
		group_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": group_label,
				"route": f"{self.route}/{frappe.scrub(group_label).replace('_', '-')}",
				"is_group": 1,
				"is_published": 1,
				"content": "",
				"parent_wiki_document": self.root_group,
				"sort_order": sort_order,
			}
		)
		group_doc.insert(ignore_permissions=True)

		for page_sort_order, item in enumerate(items):
			self._create_page_document(item.wiki_page, group_doc.name, page_sort_order)

	def _create_page_document(self, wiki_page_name, parent_group, sort_order):
		"""Create a leaf Wiki Document from a Wiki Page"""
		wiki_page = frappe.get_cached_doc("Wiki Page", wiki_page_name)
		leaf_doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": wiki_page.title,
				"route": wiki_page.route,
				"is_group": 0,
				"is_published": wiki_page.published,
				"is_private": not wiki_page.allow_guest,
				"content": wiki_page.content,
				"parent_wiki_document": parent_group,
				"sort_order": sort_order,
			}
		)
		leaf_doc.insert(ignore_permissions=True)

	@frappe.whitelist()
	def update_routes(self, new_route: str) -> dict:
		"""Update Wiki Space route and all Wiki Documents under it."""
		frappe.only_for("Wiki Manager")

		from frappe.utils.nestedset import get_descendants_of

		new_route = new_route.strip().strip("/")

		if not new_route:
			frappe.throw(_("Route cannot be empty"))

		old_route = self.route
		if old_route == new_route:
			frappe.throw(_("New route is the same as current route"))

		if not self.root_group:
			frappe.throw(_("This Wiki Space has no root group. Migrate to Version 3 first."))

		# Check for conflicts
		existing = frappe.db.get_value("Wiki Space", {"route": new_route, "name": ("!=", self.name)})
		if existing:
			frappe.throw(_("Route '{0}' is already used by another Wiki Space").format(new_route))

		# Get all documents under this space
		descendants = get_descendants_of("Wiki Document", self.root_group, ignore_permissions=True)
		all_docs = [self.root_group, *list(descendants)]

		# Batch update document routes
		updated_count = self._batch_update_document_routes(all_docs, old_route, new_route)

		# Update space route
		self.route = new_route
		self.save()

		return {"updated_count": updated_count}

	def _batch_update_document_routes(self, doc_names: list, old_route: str, new_route: str) -> int:
		"""Batch update routes using SQL REPLACE."""
		if not doc_names:
			return 0

		placeholders = ", ".join(["%s"] * len(doc_names))

		# Wiki Document strips leading slashes in validate, so routes are always without leading slash
		# Handle two cases:
		# 1. Exact match (root group): old_route -> new_route
		# 2. Prefix match (children): old_route/... -> new_route/...
		frappe.db.sql(
			f"""
			UPDATE `tabWiki Document`
			SET route = CASE
				WHEN route = %s THEN %s
				WHEN route LIKE %s THEN CONCAT(%s, SUBSTRING(route, %s))
				ELSE route
			END,
			modified = NOW(),
			modified_by = %s
			WHERE name IN ({placeholders})
			""",
			(
				old_route,  # exact match old route (root group)
				new_route,  # replace with new route
				f"{old_route}/%",  # starts with old route (children)
				new_route,  # new prefix
				len(old_route) + 1,  # substring position after old_route
				frappe.session.user,
				*doc_names,
			),
		)

		return len(doc_names)

	@frappe.whitelist()
	def clone_wiki_space_in_background(self, new_space_route: str) -> dict:
		frappe.only_for("Wiki Manager")

		new_route = (new_space_route or "").strip().strip("/")
		if not new_route:
			frappe.throw(_("Route cannot be empty"))

		if new_route == self.route:
			frappe.throw(_("New route is the same as current route"))

		existing = frappe.db.get_value("Wiki Space", {"route": new_route}, "name")
		if existing:
			frappe.throw(_("Route '{0}' is already used by another Wiki Space").format(new_route))

		if not self.root_group:
			frappe.throw(_("This Wiki Space has no root group. Migrate to Version 3 first."))

		frappe.enqueue(
			"wiki.wiki.doctype.wiki_space.wiki_space.clone_wiki_space",
			queue="long",
			job_name=f"clone_wiki_space:{self.name}:{new_route}",
			wiki_space=self.name,
			new_space_route=new_route,
			user=frappe.session.user,
		)

		return {"status": "queued", "new_route": new_route}


def clone_wiki_space(wiki_space: str, new_space_route: str, user: str | None = None) -> str:
	if user:
		frappe.set_user(user)  # nosemgrep: frappe-setuser - restoring user context in background job

	space = frappe.get_doc("Wiki Space", wiki_space)
	if not space.root_group:
		frappe.throw(_("This Wiki Space has no root group. Migrate to Version 3 first."))

	new_route = (new_space_route or "").strip().strip("/")
	if not new_route:
		frappe.throw(_("Route cannot be empty"))

	new_space = _create_space_copy(space, new_route)
	_clone_wiki_documents(space, new_space)
	return new_space.name


def _create_space_copy(space: Document, new_route: str) -> Document:
	new_space = frappe.new_doc("Wiki Space")

	for field in space.meta.fields:
		if field.fieldtype in ("Section Break", "Tab Break", "Column Break", "HTML", "Button"):
			continue
		if field.fieldtype == "Table":
			continue
		if field.fieldname in ("route", "root_group", "main_revision"):
			continue
		new_space.set(field.fieldname, space.get(field.fieldname))

	new_space.route = new_route

	for field in space.meta.fields:
		if field.fieldtype != "Table":
			continue
		fieldname = field.fieldname
		new_space.set(fieldname, [])
		for row in space.get(fieldname) or []:
			row_data = row.as_dict()
			for key in _CHILD_ROW_META_FIELDS:
				row_data.pop(key, None)
			new_space.append(fieldname, row_data)

	new_space.insert(ignore_permissions=True)
	return new_space


def _clone_wiki_documents(space: Document, new_space: Document) -> None:
	root = frappe.get_doc("Wiki Document", space.root_group)
	docs = frappe.get_all(
		"Wiki Document",
		fields=[
			"name",
			"title",
			"slug",
			"route",
			"is_group",
			"is_published",
			"is_private",
			"is_external_link",
			"external_url",
			"content",
			"parent_wiki_document",
			"sort_order",
			"lft",
		],
		filters={"lft": (">=", root.lft), "rgt": ("<=", root.rgt)},
		order_by="lft asc",
	)

	old_root = space.root_group
	new_root = new_space.root_group
	name_map = {old_root: new_root}

	for doc in docs:
		if doc["name"] == old_root:
			continue

		parent_name = name_map.get(doc.get("parent_wiki_document"))
		new_doc = frappe.new_doc("Wiki Document")
		new_doc.title = doc.get("title")
		new_doc.slug = doc.get("slug")
		new_doc.route = _clone_route(doc.get("route"), space.route, new_space.route)
		new_doc.is_group = doc.get("is_group")
		new_doc.is_published = doc.get("is_published")
		new_doc.is_private = doc.get("is_private")
		new_doc.is_external_link = doc.get("is_external_link")
		new_doc.external_url = doc.get("external_url")
		new_doc.content = doc.get("content")
		new_doc.parent_wiki_document = parent_name

		new_doc.insert(ignore_permissions=True)

		sort_order = doc.get("sort_order")
		if sort_order is not None:
			frappe.db.set_value(
				"Wiki Document",
				new_doc.name,
				"sort_order",
				sort_order,
				update_modified=False,
			)

		name_map[doc["name"]] = new_doc.name


def _clone_route(route: str, old_base: str, new_base: str):
	if not route or not old_base or not new_base:
		return route

	if route == old_base:
		return new_base

	prefix = f"{old_base}/"
	if route.startswith(prefix):
		return f"{new_base}{route[len(old_base):]}"

	return route
