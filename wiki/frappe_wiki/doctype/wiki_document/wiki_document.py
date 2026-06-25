# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import pretty_date
from frappe.utils.nestedset import NestedSet, get_descendants_of
from frappe.utils.print_utils import get_print
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

from wiki.wiki.markdown import render_markdown, render_markdown_with_toc

WIKI_DOCUMENT_PRINT_FORMAT = "Standard Wiki Document"

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
		doc_key: DF.Data | None
		is_group: DF.Check
		is_published: DF.Check
		lft: DF.Int
		old_parent: DF.Link | None
		parent_wiki_document: DF.Link | None
		rgt: DF.Int
		route: DF.Data | None
		slug: DF.Data | None
		sort_order: DF.Int
		title: DF.Data
		wiki_space: DF.Link | None
	# end: auto-generated types

	def validate(self):
		self.set_doc_key()
		self.set_slug()
		self.set_sort_order_for_new_document()
		self.set_route()
		self.remove_leading_slash_from_route()
		self.validate_unique_route_for_leaves()
		self.set_boilerplate_content()

	def validate_unique_route_for_leaves(self):
		"""Ensure no two leaf documents (non-groups) share the same route."""
		if self.is_group or not self.route:
			return

		filters = {
			"route": self.route,
			"is_group": 0,
			"name": ("!=", self.name),
		}
		existing = frappe.db.get_value("Wiki Document", filters, "name")
		if existing:
			frappe.throw(
				_("Another page with the route '{0}' already exists: {1}").format(self.route, existing)
			)

	def set_doc_key(self):
		"""Ensure doc_key is set and immutable."""
		if not self.doc_key:
			self.doc_key = frappe.generate_hash(length=12)
			return
		if not self.is_new():
			existing = frappe.db.get_value("Wiki Document", self.name, "doc_key")
			if existing and self.doc_key != existing:
				self.doc_key = existing

	def set_slug(self):
		"""Ensure slug is set for route generation."""
		if not self.slug:
			self.slug = frappe.website.utils.cleanup_page_name(self.title).replace("_", "-")

	def set_sort_order_for_new_document(self):
		"""Auto-assign sort_order for new documents to place them at the end of siblings."""
		if not self.is_new():
			return

		if not self.parent_wiki_document:
			return

		# During merge, sort_order is explicitly set from the revision's order_index
		if getattr(frappe.flags, "in_apply_merge_revision", False):
			return

		# Only auto-assign if sort_order is 0 (the default) or None
		# This means the user didn't explicitly set a sort_order
		if self.sort_order not in (None, 0):
			return

		# Get the maximum sort_order among siblings using query builder
		WikiDocument = frappe.qb.DocType("Wiki Document")
		max_sort_order = (
			frappe.qb.from_(WikiDocument)
			.where(WikiDocument.parent_wiki_document == self.parent_wiki_document)
			.select(frappe.query_builder.functions.Max(WikiDocument.sort_order))
		).run(pluck=True)[0]

		# If there are no siblings or max is None, keep sort_order as 0
		if max_sort_order is None:
			self.sort_order = 0
			return

		# Set sort_order to max + 1 to place at the end
		self.sort_order = max_sort_order + 1

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
					ancestor_slug = frappe.get_cached_value("Wiki Document", ancestor_name, "slug")
					if ancestor_slug:
						route_parts.append(ancestor_slug)

			# Add this document's slug
			slug = self.slug or frappe.website.utils.cleanup_page_name(self.title).replace("_", "-")
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

	def check_space_access(self, ptype="read", user=None):
		"""Gate content access by the owning Wiki Space's role configuration.

		On failure we raise a 404 (DoesNotExistError) rather than PermissionError
		so we don't leak the existence of restricted pages to unauthorized users
		(especially anonymous Guests).
		"""
		from wiki.permissions import can_read_space, can_write_space

		space = self.wiki_space or (self.get_wiki_space() or {}).get("name")
		if not space:
			# Orphan documents stay readable by all (preserves chromeless pages).
			return

		allowed = can_write_space(space, user) if ptype == "write" else can_read_space(space, user)
		if not allowed:
			frappe.throw(_("Page not found"), frappe.DoesNotExistError)

	def check_guest_access(self):
		"""Backwards-compatible alias: gate read access via the space's role config."""
		self.check_space_access("read")

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
		self.check_space_access("read")
		self.check_published()
		wiki_space = self.get_wiki_space()

		# Render markdown and extract TOC headings in one pass
		rendered_content, toc_headings = render_markdown_with_toc(self.content or "")
		if not frappe.db.get_single_value("Wiki Settings", "enable_table_of_contents"):
			toc_headings = []

		# Ancestor nodes that should be expanded in the sidebar tree on initial render
		expanded_nodes = set(self.get_ancestors()) if self.lft else set()

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
			"head_html": frappe.get_cached_value("Wiki Settings", "Wiki Settings", "head_html"),
			"raw_markdown": self.content or "",
			"nested_tree": [],
			"expanded_nodes": expanded_nodes,
			"prev_doc": None,
			"next_doc": None,
			"edit_link": self.get_edit_link(),
			"last_updated": pretty_date(self.modified),
			"last_updated_on": self.get_formatted("modified"),
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

	def before_print(self, print_settings=None):
		"""Render markdown content so the print format can drop it in as HTML."""
		self.rendered_content_for_pdf = render_markdown(self.content or "")

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

		# Prefer a published content page at this route. A root README/index is
		# routed at the space route itself, so this also serves /<space>/ — winning
		# over the same-route root group, which only redirects to its first child.
		leaf = frappe.db.get_value(
			"Wiki Document",
			{"route": self.path, "is_group": 0, "is_published": 1, "is_external_link": 0},
			"name",
		)
		if leaf:
			self.wiki_doc_name = leaf
			return True

		# A group / Wiki Space route with no page of its own: redirect to first child.
		root_group = frappe.db.get_value(
			"Wiki Document", {"route": self.path, "is_group": 1}, "name"
		) or frappe.db.get_value("Wiki Space", {"route": self.path, "is_published": 1}, "root_group")

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

		# Return plain markdown for AI agents and other markdown-aware clients
		accept = frappe.request.headers.get("Accept", "")
		if "text/markdown" in accept:
			doc.check_space_access("read")
			doc.check_published()
			response = Response()
			response.data = doc.content or ""
			response.headers["Content-Type"] = "text/markdown; charset=utf-8"
			return response

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
		fields=[
			"name",
			"title",
			"is_group",
			"parent_wiki_document",
			"route",
			"sort_order",
			"is_external_link",
			"external_url",
		],
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

	# Sort children by sort_order at each level
	def sort_children(nodes):
		nodes.sort(key=lambda x: (x.get("sort_order") or 0, x["name"]))
		for node in nodes:
			if node["children"]:
				sort_children(node["children"])

	sort_children(root_nodes)

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


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
def get_page_data(route: str) -> dict:
	"""Returns all data needed to render a page dynamically for client-side navigation."""
	doc_name = frappe.db.get_value(
		"Wiki Document", {"route": route, "is_published": 1, "is_external_link": 0}, "name"
	)
	if not doc_name:
		frappe.throw(frappe._("Page not found"), frappe.DoesNotExistError)

	doc = frappe.get_cached_doc("Wiki Document", doc_name)
	return doc.get_web_context()


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
def download_pdf(route: str):
	doc_name = frappe.db.get_value(
		"Wiki Document", {"route": route, "is_group": 0, "is_external_link": 0}, "name"
	)
	if not doc_name:
		frappe.throw(_("Page not found"), frappe.DoesNotExistError)

	doc = frappe.get_cached_doc("Wiki Document", doc_name)
	doc.check_space_access("read")
	doc.check_published()

	# Guests can't print by default; we've already authorized them above via check_space_access.
	frappe.local.flags.ignore_print_permissions = True
	try:
		pdf_file = get_print(
			doctype="Wiki Document",
			print_format=WIKI_DOCUMENT_PRINT_FORMAT,
			doc=doc,
			as_pdf=True,
			no_letterhead=1,
		)
	finally:
		frappe.local.flags.ignore_print_permissions = False

	frappe.local.response.filename = f"{doc.slug or doc.name}.pdf"
	frappe.local.response.filecontent = pdf_file
	frappe.local.response.content_type = "application/pdf"
	frappe.local.response.type = "download"


def on_wiki_document_update(doc, method):
	"""Stamp the owning Wiki Space and sync desk edits to the revision system."""
	stamp_wiki_space(doc)
	_sync_document_to_revision(doc)


def stamp_wiki_space(doc):
	"""Denormalize the owning Wiki Space onto a single document.

	Covers normal desk edits, clones, and merge-created documents (all of which
	insert/save and trigger on_update). Reorders use raw db.set_value and are
	re-stamped separately via stamp_wiki_space_subtree.
	"""
	from wiki.api.wiki_space import _get_wiki_space_for_document

	space_name = _get_wiki_space_for_document(doc.name)
	if doc.get("wiki_space") != space_name:
		frappe.db.set_value("Wiki Document", doc.name, "wiki_space", space_name, update_modified=False)


def stamp_wiki_space_subtree(root_doc_name):
	"""Re-stamp wiki_space on a document and all its descendants (after a move)."""
	from wiki.api.wiki_space import _get_wiki_space_for_document

	space_name = _get_wiki_space_for_document(root_doc_name)
	names = [root_doc_name, *get_descendants_of("Wiki Document", root_doc_name, ignore_permissions=True)]
	for name in names:
		frappe.db.set_value("Wiki Document", name, "wiki_space", space_name, update_modified=False)
	return space_name


def on_wiki_document_trash(doc, method):
	"""Sync desk deletions to the revision system."""
	_sync_document_to_revision(doc)


def _sync_document_to_revision(doc):
	"""Find the owning Wiki Space and refresh its main_revision.

	Skips when called during merge or reorder — those flows manage revisions
	themselves via guard flags.
	"""
	if getattr(frappe.flags, "in_apply_merge_revision", False):
		return
	if getattr(frappe.flags, "in_reorder_wiki_documents", False):
		return

	from wiki.api.wiki_space import _get_wiki_space_for_document, _sync_main_revision_for_space

	space_name = _get_wiki_space_for_document(doc.name)
	if not space_name:
		return

	_sync_main_revision_for_space(space_name)


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
