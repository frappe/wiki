# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.nestedset import NestedSet, get_descendants_of
from frappe.website.page_renderers.base_renderer import BaseRenderer


class WikiDocument(NestedSet):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		content: DF.MarkdownEditor | None
		is_group: DF.Check
		is_published: DF.Check
		lft: DF.Int
		old_parent: DF.Link | None
		parent_wiki_document: DF.Link | None
		rgt: DF.Int
		route: DF.Data | None
		title: DF.Data
	# end: auto-generated types

	def validate(self):
		self.set_route()

	def set_route(self):
		if not self.route:
			self.route = frappe.website.utils.cleanup_page_name(self.title).replace("_", "-")


class WikiDocumentRenderer(BaseRenderer):
	def can_render(self) -> bool:
		document_name = frappe.db.get_value("Wiki Document", {"route": self.path, "is_published": 1}, "name")
		if document_name:
			self.wiki_doc_name = document_name
			return True

		return False

	def render(self):
		doc = frappe.get_cached_doc("Wiki Document", self.wiki_doc_name)

		wiki_space_root = doc.get_ancestors()[-1]
		wiki_space = frappe.get_cached_value("Wiki Space", {"root_group": wiki_space_root}, "name")
		wiki_space = frappe.get_cached_doc("Wiki Space", wiki_space)

		descendants = get_descendants_of("Wiki Document", wiki_space_root)
		nested_tree = build_nested_wiki_tree(descendants)

		content_html = frappe.utils.md_to_html(doc.content)
		html = frappe.render_template(
			"templates/wiki/document.html",
			{
				"doc": doc,
				"wiki_space": wiki_space,
				"rendered_content": content_html,
				"nested_tree": nested_tree,
			},
		)
		return self.build_response(html)


def build_nested_wiki_tree(documents: list[str]):
	# Create a mapping of document name to document data
	wiki_documents = frappe.db.get_all(
		"Wiki Document",
		fields=["name", "title", "is_group", "parent_wiki_document", "route"],
		filters={"name": ("in", documents), "is_published": 1},
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

	return root_nodes
