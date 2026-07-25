# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import pretty_date
from frappe.utils.nestedset import NestedSet, get_descendants_of
from frappe.utils.print_utils import get_print
from frappe.website.page_renderers.base_renderer import BaseRenderer
from frappe.website.utils import clear_cache as clear_website_cache
from frappe.website.website_components.metatags import MetaTags
from werkzeug.wrappers import Response

from wiki.wiki.markdown import render_markdown, render_markdown_with_toc

WIKI_DOCUMENT_PRINT_FORMAT = "Standard Wiki Document"

WIKI_TREE_CACHE_KEY = "wiki_public_tree"

# The synthetic "Home" tab standing for a space's untabbed top-level content.
# Kept in sync with GENERAL_KEY in frontend/src/lib/spaceTabs.js.
WIKI_HOME_TAB_KEY = "__general__"

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


def is_top_level_group(parent_name: str | None) -> bool:
	"""True when `parent_name` is a Wiki Space's root_group.

	Top-level == direct child of the space root, which is what makes a node
	eligible to be a tab.
	"""
	if not parent_name:
		return False
	return bool(frappe.db.exists("Wiki Space", {"root_group": parent_name}))


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
		is_tab: DF.Check
		lft: DF.Int
		meta_description: DF.SmallText | None
		meta_image: DF.AttachImage | None
		meta_title: DF.Data | None
		old_parent: DF.Link | None
		parent_wiki_document: DF.Link | None
		rgt: DF.Int
		route: DF.Data | None
		slug: DF.Data | None
		sort_order: DF.Int
		tab_icon: DF.Data | None
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
		self.validate_tab()
		self.set_boilerplate_content()

	def validate_tab(self):
		"""A tab is a top-level group. Both halves of that are hard rules.

		Enforced here rather than only in the UI because a tab restructures the
		whole space's navigation: a leaf tab or a nested tab has no place to
		render, so the tab bar would silently drop it.
		"""
		if not self.is_tab:
			return

		if not self.is_group:
			frappe.throw(_("Only a group can be marked as a tab."))

		if not is_top_level_group(self.parent_wiki_document):
			frappe.throw(_("Only a top-level group can be marked as a tab. Nested tabs are not supported."))

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

	def _can_show_edit(self, wiki_space_doc, user=None) -> bool:
		"""Whether to render the reader's Edit button for the current user.

		Shown when the space accepts contributions (anyone, including anonymous
		visitors who then hit the login redirect — unchanged) or when the user has
		write/merge access (managers always see Edit even with contributions off).
		"""
		from wiki.permissions import _space_accepts_contributions, can_write_space

		# Mirror the backend's contribution gate exactly (it treats a missing/NULL
		# flag as enabled) so the button and the CR endpoints never disagree.
		if _space_accepts_contributions(wiki_space_doc):
			return True
		return can_write_space(wiki_space_doc.name, user)

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

		nested_tree = get_public_wiki_tree(root_group)
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
			"space_tabs": [],
			"expanded_nodes": expanded_nodes,
			"prev_doc": None,
			"next_doc": None,
			"edit_link": self.get_edit_link(),
			"last_updated": pretty_date(self.modified),
			"last_updated_on": self.get_formatted("modified"),
			"hide_chrome": not wiki_space,
			"can_edit": False,
			"breadcrumbs": None,
		}

		metatags = {
			"title": self.meta_title or self.title,
			"og:site_name": wiki_space.get("space_name") if wiki_space else None,
		}
		if self.meta_description:
			metatags["description"] = self.meta_description
		if self.meta_image:
			metatags["image"] = self.meta_image
		context["metatags"] = {key: value for key, value in metatags.items() if value}
		context["metatags"] = MetaTags(self.route, context).tags
		context["canonical_url"] = frappe.utils.get_url("/" + self.route) if self.route else None

		if not wiki_space:
			return context

		wiki_space_doc = frappe.get_cached_doc("Wiki Space", wiki_space.name)
		nested_tree, adjacent_docs = self.get_tree_and_navigation()

		context.update(
			{
				"wiki_space": wiki_space_doc,
				"can_edit": self._can_show_edit(wiki_space_doc),
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
				"space_tabs": get_space_tabs(wiki_space.name),
				"prev_doc": adjacent_docs["prev"],
				"next_doc": adjacent_docs["next"],
				# Escape "<" so user-supplied titles can't close the
				# <script> element the template embeds this JSON into.
				"breadcrumbs": json.dumps(self.get_breadcrumb_list(wiki_space)).replace("<", "\\u003c"),
			}
		)

		return context

	def get_breadcrumb_list(self, wiki_space: dict) -> dict:
		"""Build a BreadcrumbList JSON-LD payload mirroring the visible reader UI.

		The reader sidebar renders ancestor groups as non-clickable toggle
		buttons (see sidebar_tree.html) -- they never resolve to a served URL.
		Per Google's breadcrumb structured-data rules every item but the last
		needs an `item` URL, so those unlinkable ancestor groups are dropped
		from the trail entirely rather than emitted without one.
		"""
		space_item = {
			"@type": "ListItem",
			"position": 1,
			"name": wiki_space.get("space_name") or wiki_space["name"],
			"item": frappe.utils.get_url("/" + wiki_space["route"]),
		}
		current_item = {
			"@type": "ListItem",
			"position": 2,
			"name": self.title,
		}
		if self.route:
			current_item["item"] = frappe.utils.get_url("/" + self.route)

		return {
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			"itemListElement": [space_item, current_item],
		}

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

		# Redirect to the first page in sidebar order (sort_order at each level),
		# so the space URL lands on the same document the sidebar shows first.
		if root_group:
			first_page = get_first_published_page(root_group)
			if first_page:
				frappe.redirect("/" + first_page["route"])

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
			"is_tab",
			"tab_icon",
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


def get_public_wiki_tree(root_group: str) -> list:
	"""Return the published sidebar tree for a root group, cached in Redis.

	The cache is invalidated on any Wiki Document change (see
	clear_wiki_tree_cache), so a hit always reflects the committed tree.
	"""
	tree = frappe.cache().hget(WIKI_TREE_CACHE_KEY, root_group)
	if tree is None:
		descendants = get_descendants_of("Wiki Document", root_group, ignore_permissions=True)
		tree = build_nested_wiki_tree(descendants)
		frappe.cache().hset(WIKI_TREE_CACHE_KEY, root_group, tree)
	return tree


def get_first_published_page(root_group: str) -> dict | None:
	"""First non-group, non-external page in sidebar order — the document a
	space URL should land on. Walks the same tree the sidebar renders, so the
	two can't disagree."""
	return _first_published_leaf(get_public_wiki_tree(root_group))


def _first_published_leaf(nodes: list) -> dict | None:
	"""First non-group, non-external page in sidebar order within `nodes`."""
	for node in nodes:
		if not node["is_group"] and not node.get("is_external_link"):
			return node
		found = _first_published_leaf(node["children"])
		if found:
			return found
	return None


def _tab_landing_route(tab: dict, node: dict | None) -> str | None:
	"""Where clicking a tab should go.

	A group is never served at its own route — the renderer redirects it to its
	first child — so the "tab group's own content page" only exists as a
	published leaf sitting at the group's route (the README/index case that
	git-sync produces). Prefer that, else the first published leaf in the tab's
	subtree, mirroring get_first_published_page.
	"""
	if tab.get("route") and frappe.db.exists(
		"Wiki Document",
		{"route": tab["route"], "is_group": 0, "is_published": 1, "is_external_link": 0},
	):
		return tab["route"]

	if not node:
		return None
	first = _first_published_leaf(node.get("children") or [])
	return first["route"] if first else None


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
def get_space_tabs(space: str) -> list[dict]:
	"""Ordered top-level tab groups for a Wiki Space, each with its landing route.

	Reads the same cached public tree the sidebar renders, so a tab can never
	point somewhere the sidebar doesn't show.
	"""
	from wiki.permissions import can_read_space

	if not can_read_space(space):
		return []

	root_group = frappe.db.get_value("Wiki Space", space, "root_group")
	if not root_group:
		return []

	tabs = frappe.get_all(
		"Wiki Document",
		filters={
			"parent_wiki_document": root_group,
			"is_tab": 1,
			"is_group": 1,
			"is_published": 1,
		},
		fields=["name", "doc_key", "title", "route", "tab_icon"],
		order_by="sort_order asc, title asc",
	)
	if not tabs:
		return []

	# A tab whose subtree has no published page is dropped from the public tree
	# by remove_empty_groups, so `nodes_by_name.get` is deliberately tolerant.
	tree = get_public_wiki_tree(root_group)
	nodes_by_name = {node["name"]: node for node in tree}

	result = [
		{
			"name": tab["name"],
			"doc_key": tab["doc_key"],
			"title": tab["title"],
			"route": tab["route"],
			"tab_icon": tab["tab_icon"],
			"landing_route": _tab_landing_route(tab, nodes_by_name.get(tab["name"])),
		}
		for tab in tabs
	]

	# Home leads the bar only when the space has several tabs and untabbed
	# top-level content to land on. With a single tab a Home entry is just noise;
	# a fully-tabbed space has nowhere for Home to point — both cases omit it.
	if len(result) >= 2:
		home = _home_tab_entry(tree)
		if home:
			result.insert(0, home)

	return result


def _home_tab_entry(tree: list) -> dict | None:
	"""The synthetic Home tab pointing at the space's untabbed top-level content,
	or None when there is no such content to land on."""
	untabbed = [node for node in tree if not node.get("is_tab")]
	landing = _first_published_leaf(untabbed)
	if not landing:
		return None
	return {
		"name": None,
		"doc_key": WIKI_HOME_TAB_KEY,
		"title": _("Home"),
		"route": landing["route"],
		"tab_icon": "lucide-house",
		"landing_route": landing["route"],
	}


def clear_wiki_tree_cache():
	"""Drop all cached sidebar trees.

	Cleared wholesale rather than per space: a move can pull a subtree from one
	space into another, staling both trees while the document only knows its
	new space. Cleared again after commit to close the race where another
	worker re-caches from pre-commit DB state.
	"""
	frappe.cache().delete_value(WIKI_TREE_CACHE_KEY)
	frappe.db.after_commit.add(lambda: frappe.cache().delete_value(WIKI_TREE_CACHE_KEY))


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
	_clear_stale_website_cache(doc)
	clear_wiki_tree_cache()
	_drop_from_search_index_on_unpublish(doc)


def _drop_from_search_index_on_unpublish(doc):
	from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import remove_doc_from_index

	if doc.has_value_changed("is_published") and not doc.is_published:
		# The index lives in a separate SQLite file, outside this transaction.
		# Deferring until after commit keeps the row when the save rolls back;
		# on rollback the callback queue is discarded.
		docname = doc.name
		frappe.db.after_commit.add(lambda: remove_doc_from_index(docname))


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
	_clear_stale_website_cache(doc, deleted=True)
	clear_wiki_tree_cache()


def _clear_stale_website_cache(doc, deleted=False):
	"""Invalidate Frappe's website caches for this document's routes.

	Frappe remembers every guest URL that 404'd (the ``website_404`` cache) and
	short-circuits all later requests to it, so a page published or renamed
	after its URL was ever visited keeps returning 404 until the cache is
	invalidated. ``clear_website_cache`` drops the whole ``website_404`` map
	along with the routing caches for the given path.

	The immediate clear serves the current process; the after-commit clear
	closes the race where another worker re-caches a 404 from pre-commit DB
	state between our clear and the transaction commit.
	"""
	route_affecting_fields = ("route", "is_published", "is_external_link")
	if not deleted and not any(doc.has_value_changed(f) for f in route_affecting_fields):
		return

	before = doc.get_doc_before_save()
	routes = {doc.route, before.route if before else None} - {None, ""}
	if not routes:
		return

	for route in routes:
		clear_website_cache(route)
	frappe.db.after_commit.add(lambda routes=routes: [clear_website_cache(route) for route in routes])


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
