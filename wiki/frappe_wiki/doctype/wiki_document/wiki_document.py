# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import pretty_date
from frappe.utils.nestedset import NestedSet, get_descendants_of
from frappe.website.page_renderers.base_renderer import BaseRenderer

from wiki.wiki.markdown import render_markdown_with_toc

# Mapping of known service domains to icon identifiers
KNOWN_SERVICE_ICONS = {
	"github.com": "github",
	"youtube.com": "youtube",
	"twitter.com": "twitter",
	"x.com": "twitter",
	"linkedin.com": "linkedin",
	"discord.com": "discord",
	"discord.gg": "discord",
	"slack.com": "slack",
	"facebook.com": "facebook",
	"instagram.com": "instagram",
	"reddit.com": "reddit",
}


def process_navbar_items(navbar_items: list) -> list:
	"""
	Process navbar items to add icon detection for known services.

	Args:
	        navbar_items: List of Top Bar Item documents

	Returns:
	        List of processed navbar item dicts with icon info
	"""
	processed = []
	for item in navbar_items:
		icon = None
		if item.url:
			domain = urlparse(item.url).netloc.replace("www.", "")
			for service_domain, icon_name in KNOWN_SERVICE_ICONS.items():
				if service_domain in domain:
					icon = icon_name
					break

		processed.append(
			{
				"label": item.label,
				"url": item.url,
				"icon": icon,
				"open_in_new_tab": item.open_in_new_tab,
				"right": item.right,
			}
		)
	return processed


class WikiDocument(NestedSet):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		content: DF.Code | None
		is_group: DF.Check
		is_private: DF.Check
		is_published: DF.Check
		lft: DF.Int
		old_parent: DF.Link | None
		parent_wiki_document: DF.Link | None
		rgt: DF.Int
		route: DF.Data | None
		sort_order: DF.Int
		title: DF.Data
	# end: auto-generated types

	def validate(self):
		self.set_route()
		self.remove_leading_slash_from_route()
		self.set_boilerplate_content()

	def set_boilerplate_content(self):
		if not self.content and not self.is_group:
			self.content = "Welcome to your new wiki page! Start editing this content to add information, images, and more."

	def set_route(self):
		if not self.route:
			# Build route from ancestor path
			route_parts = []

			# For new documents, get_ancestors() won't work as lft/rgt aren't set yet
			# Use parent_wiki_document to build the ancestor chain
			ancestors = []
			if not self.is_new():
				ancestors = self.get_ancestors()
			else:
				# Build ancestor list by traversing parent_wiki_document
				current_parent = self.parent_wiki_document
				while current_parent:
					ancestors.append(current_parent)
					current_parent = frappe.get_cached_value(
						"Wiki Document", current_parent, "parent_wiki_document"
					)

			# Get Wiki Space route as the base
			root_group = None
			if ancestors:
				root_group = ancestors[-1]
			elif self.parent_wiki_document:
				root_group = self.parent_wiki_document

			if root_group:
				space_route = frappe.get_cached_value("Wiki Space", {"root_group": root_group}, "route")
				if space_route:
					route_parts.append(space_route)

			if ancestors:
				# ancestors are ordered from immediate parent to root
				# Exclude the root group (last item) as it's the Wiki Space root
				for ancestor_name in reversed(ancestors[:-1]):
					ancestor_route = frappe.get_cached_value("Wiki Document", ancestor_name, "route")
					if ancestor_route:
						route_parts.append(ancestor_route)

			# Add this document's slug
			slug = frappe.website.utils.cleanup_page_name(self.title).replace("_", "-")
			route_parts.append(slug)

			self.route = "/".join(route_parts)

	def remove_leading_slash_from_route(self):
		if self.route and self.route.startswith("/"):
			self.route = self.route[1 : len(self.route)]

	def get_root_group(self) -> str | None:
		"""Get the root group (Wiki Space root) for this document."""
		ancestors = self.get_ancestors()
		if ancestors:
			return ancestors[-1]
		return self.parent_wiki_document

	def get_wiki_space(self) -> dict | None:
		"""Get the Wiki Space this document belongs to."""
		root_group = self.get_root_group()
		if not root_group:
			return None
		return frappe.get_cached_value(
			"Wiki Space", {"root_group": root_group}, ["name", "space_name", "route"], as_dict=True
		)

	def get_edit_link(self) -> str:
		wiki_space = self.get_wiki_space()
		if not wiki_space:
			return ""
		return f"/wiki/spaces/{wiki_space.name}/page/{self.name}"

	def check_guest_access(self):
		"""
		Check if the current user has permission to view this document.
		Raises PermissionError if access is denied.
		"""
		if self.is_private and frappe.session.user == "Guest":
			frappe.throw(
				frappe._("You must be logged in to view this page"),
				frappe.PermissionError,
			)

	def check_published(self):
		if not self.is_published:
			frappe.throw(
				frappe._("Page not found"),
				frappe.DoesNotExistError,
			)

		space = self.get_wiki_space()
		space_doc = None
		if space:
			space_doc = frappe.get_cached_doc("Wiki Space", space["name"])
		if space_doc and not space_doc.is_published:
			frappe.throw(
				frappe._("Page not found"),
				frappe.DoesNotExistError,
			)

	def get_tree_and_navigation(self) -> tuple[list, dict]:
		"""
		Get the wiki tree and adjacent documents for navigation.

		Returns:
		        tuple of (nested_tree, adjacent_docs)
		"""
		root_group = self.get_root_group()
		if not root_group:
			return [], {"prev": None, "next": None}

		descendants = get_descendants_of("Wiki Document", root_group, ignore_permissions=True)
		nested_tree = build_nested_wiki_tree(descendants)
		adjacent_docs = get_adjacent_documents(nested_tree, self.route)

		return nested_tree, adjacent_docs

	@frappe.whitelist()
	def get_breadcrumbs(self) -> dict:
		"""Get the breadcrumb trail for this Wiki Document including space info."""
		ancestors = self.get_ancestors()

		# Build breadcrumb items from ancestors (excluding root)
		breadcrumb_items = []
		for ancestor_name in reversed(ancestors):
			doc = frappe.get_cached_doc("Wiki Document", ancestor_name)
			breadcrumb_items.append(
				{
					"name": doc.name,
					"title": doc.title,
					"is_group": doc.is_group,
				}
			)

		# Get the space that owns this document tree
		wiki_space = self.get_wiki_space()
		space = None
		if wiki_space:
			space = {
				"name": wiki_space.name,
				"space_name": wiki_space.space_name,
				"route": wiki_space.route,
			}

		return {
			"ancestors": breadcrumb_items,
			"space": space,
			"current": {
				"name": self.name,
				"title": self.title,
			},
		}

	def get_web_context(self) -> dict:
		"""Get all context needed to render this Wiki Document."""
		self.check_guest_access()
		self.check_published()
		wiki_space = self.get_wiki_space()

		# Render markdown and extract TOC headings in one pass
		rendered_content, toc_headings = render_markdown_with_toc(self.content or "")

		# Base context with defaults for orphan documents
		context = {
			"doc": self,
			"title": self.title,
			"route": self.route,
			"wiki_space": None,
			"wiki_spaces_for_switcher": [],
			"navbar_items": [],
			"favicon": None,
			"rendered_content": rendered_content,
			"toc_headings": toc_headings,
			"raw_markdown": self.content or "",
			"nested_tree": [],
			"prev_doc": None,
			"next_doc": None,
			"edit_link": self.get_edit_link(),
			"last_updated": pretty_date(self.modified),
			"last_updated_on": frappe.utils.format_datetime(self.modified),
			"hide_chrome": not wiki_space,
		}

		if not wiki_space:
			return context

		wiki_space_doc = frappe.get_cached_doc("Wiki Space", wiki_space.name)
		nested_tree, adjacent_docs = self.get_tree_and_navigation()

		context.update(
			{
				"wiki_space": wiki_space_doc,
				"wiki_spaces_for_switcher": frappe.get_all(
					"Wiki Space",
					fields=["name", "space_name", "route", "light_mode_logo", "app_switcher_logo"],
					or_filters={"show_in_switcher": 1, "name": wiki_space["name"]},
					order_by="switcher_order asc, space_name asc",
				),
				"navbar_items": process_navbar_items(wiki_space_doc.navbar_items)
				if wiki_space_doc.navbar_items
				else [],
				"favicon": wiki_space_doc.favicon,
				"nested_tree": nested_tree,
				"prev_doc": adjacent_docs["prev"],
				"next_doc": adjacent_docs["next"],
			}
		)

		return context

	@frappe.whitelist()
	def get_children_count(self) -> int:
		"""Get the count of children for this Wiki Document that the user can read."""
		descendants = get_descendants_of("Wiki Document", self.name)
		if not descendants:
			return 0

		# Filter to only include documents the user has read permission for
		permitted_descendants = [
			name for name in descendants if frappe.has_permission("Wiki Document", "read", name)
		]
		return len(permitted_descendants)

	@frappe.whitelist()
	def delete_with_children(self) -> dict:
		"""Delete this Wiki Document and all its children."""
		# Check permission on the root document
		if not frappe.has_permission("Wiki Document", "delete", doc=self.name):
			frappe.throw(_("You don't have permission to delete this document"), frappe.PermissionError)

		descendants = get_descendants_of("Wiki Document", self.name)
		child_count = 0

		# Check delete permission on all descendants before deleting any
		if descendants:
			for child_name in descendants:
				if not frappe.has_permission("Wiki Document", "delete", doc=child_name):
					frappe.throw(
						_("You don't have permission to delete child document: {0}").format(child_name),
						frappe.PermissionError,
					)
			child_count = len(descendants)

		# Delete all descendants first (NestedSet requires this)
		# Use frappe.get_doc().delete() to enforce permission checks
		if descendants:
			for child_name in reversed(descendants):
				child_doc = frappe.get_doc("Wiki Document", child_name)
				child_doc.delete()

		# Delete the document itself
		frappe.delete_doc("Wiki Document", self.name)

		return {"deleted": self.name, "children_deleted": child_count}


class WikiDocumentRenderer(BaseRenderer):
	def can_render(self) -> bool:
		if self.path == "wiki" or self.path.startswith("wiki/"):
			return False

		document = frappe.db.get_value(
			"Wiki Document", {"route": self.path}, ["name", "is_group", "is_published"], as_dict=True
		)
		if document and not document.is_group and document.is_published:
			self.wiki_doc_name = document.name
			return True

		# Get root group - either from a group document or from a Wiki Space route
		root_group = None
		if document and document.is_group:
			root_group = document.name
		else:
			# Check if this is a Wiki Space route
			root_group = frappe.db.get_value(
				"Wiki Space", {"route": self.path, "is_published": 1}, "root_group"
			)

		# Redirect to first published child document if available
		if root_group:
			child_docs = get_descendants_of(
				"Wiki Document", root_group, order_by="lft asc, sort_order desc", ignore_permissions=True
			)
			for child_name in child_docs:
				child_doc = frappe.get_cached_doc("Wiki Document", child_name)
				if not child_doc.is_group and child_doc.is_published:
					frappe.redirect("/" + child_doc.route)

		return False

	def render(self):
		doc = frappe.get_cached_doc("Wiki Document", self.wiki_doc_name)
		context = doc.get_web_context()

		csrf_token = frappe.sessions.get_csrf_token()
		frappe.db.commit()  # nosemgrep

		context["csrf_token"] = csrf_token

		html = frappe.render_template("templates/wiki/document.html", context)
		return self.build_response(html)


def build_nested_wiki_tree(documents: list[str]):
	# Create a mapping of document name to document data
	wiki_documents = frappe.db.get_all(
		"Wiki Document",
		fields=["name", "title", "is_group", "parent_wiki_document", "route"],
		filters={"name": ("in", documents)},
		or_filters={"is_published": 1, "is_group": 1},
		order_by="lft asc",
	)

	doc_map = {doc["name"]: {**doc, "children": []} for doc in wiki_documents}

	# Find root nodes and build the tree
	root_nodes = []

	for doc in wiki_documents:
		parent_name = doc["parent_wiki_document"]

		# If parent exists in our dataset, add as child
		if parent_name and parent_name in doc_map:
			doc_map[parent_name]["children"].append(doc_map[doc["name"]])
		else:
			# This is a root node (parent not in our dataset)
			root_nodes.append(doc_map[doc["name"]])

	# Remove empty groups recursively
	def remove_empty_groups(nodes):
		filtered_nodes = []
		for node in nodes:
			if node["is_group"]:
				# Recursively filter children first
				node["children"] = remove_empty_groups(node["children"])
				# Only include group if it has children with content
				if has_published_content(node):
					filtered_nodes.append(node)
			else:
				# Include non-group nodes (they are already published due to DB filtering)
				filtered_nodes.append(node)
		return filtered_nodes

	def has_published_content(node):
		# If it's not a group, it has content (already filtered to be published at DB level)
		if not node["is_group"]:
			return True

		# If it's a group, check if any of its children have content
		if node["is_group"]:
			for child in node["children"]:
				if has_published_content(child):
					return True

		return False

	return remove_empty_groups(root_nodes)


@frappe.whitelist()
def get_breadcrumbs(name: str) -> dict:
	"""Get the breadcrumb trail for a Wiki Document including space info."""
	doc = frappe.get_cached_doc("Wiki Document", name)
	return doc.get_breadcrumbs()


@frappe.whitelist(allow_guest=True)
def get_page_data(route: str) -> dict:
	"""Returns all data needed to render a page dynamically for client-side navigation."""
	doc_name = frappe.db.get_value("Wiki Document", {"route": route, "is_published": 1}, "name")
	if not doc_name:
		frappe.throw(frappe._("Page not found"), frappe.DoesNotExistError)

	doc = frappe.get_cached_doc("Wiki Document", doc_name)
	return doc.get_web_context()


def get_adjacent_documents(nested_tree: list, current_route: str) -> dict:
	"""
	Get the previous and next documents based on the flattened tree order.
	Only returns non-group documents (actual pages).

	Args:
	        nested_tree: The nested tree structure from build_nested_wiki_tree
	        current_route: The route of the current document

	Returns:
	        dict with 'prev' and 'next' keys, each containing {title, route} or None
	"""

	def flatten_tree(nodes: list) -> list:
		"""Flatten the nested tree into a list of non-group documents in order."""
		result = []
		for node in nodes:
			if not node.get("is_group"):
				result.append({"title": node["title"], "route": node["route"]})
			if node.get("children"):
				result.extend(flatten_tree(node["children"]))
		return result

	flat_list = flatten_tree(nested_tree)

	# Find current document index
	current_index = None
	for i, doc in enumerate(flat_list):
		if doc["route"] == current_route:
			current_index = i
			break

	result = {"prev": None, "next": None}

	if current_index is not None:
		if current_index > 0:
			result["prev"] = flat_list[current_index - 1]
		if current_index < len(flat_list) - 1:
			result["next"] = flat_list[current_index + 1]

	return result
