# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""llms.txt generation — an index of a wiki, written for LLM crawlers.

Follows the llmstxt.org format: an H1, an optional blockquote summary, then H2
sections containing nothing but markdown lists of links.

Everything here is generated from the *published, Guest-readable* wiki only, and
never from the requesting session — see wiki/wiki/crawler_renderer.py for why.
"""

import frappe
from frappe import _

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
	get_first_published_page,
	get_public_wiki_tree,
)

MARKDOWN_HINT = "Append `.md` to any URL below for that page's raw markdown source."


def build_space_llms_txt(space: str) -> str | None:
	"""The llms.txt index for one Wiki Space, or None when it has no published pages.

	Sections mirror the space's tabs, and each section's list mirrors the
	sidebar tree — same source, so this index can never advertise a page the
	reader doesn't show.
	"""
	space_doc = frappe.db.get_value(
		"Wiki Space",
		space,
		["name", "space_name", "route", "root_group", "home_tab_title"],
		as_dict=True,
	)
	if not space_doc or not space_doc.root_group:
		return None

	tree = get_public_wiki_tree(space_doc.root_group)
	if not tree:
		return None

	pages = _published_pages(space_doc.name)

	# Top-level tab groups become sections; anything untabbed goes under the
	# space's Home tab, matching _home_tab_entry in the reader.
	sections = []
	untabbed = [node for node in tree if not node.get("is_tab")]
	if untabbed:
		sections.append((space_doc.home_tab_title or _("Home"), untabbed))
	sections += [(node["title"], node.get("children") or []) for node in tree if node.get("is_tab")]

	body = []
	for title, nodes in sections:
		items = _render_nodes(nodes, pages, depth=0)
		if items:
			body += ["", f"## {title}", "", *items]

	if not body:
		return None

	lines = [f"# {space_doc.space_name or space_doc.name}", ""]
	summary = _space_summary(space_doc.root_group, pages)
	if summary:
		lines += [f"> {summary}", ""]
	lines.append(MARKDOWN_HINT)

	return "\n".join(lines + body) + "\n"


def _published_pages(space_name: str) -> dict:
	"""``{route: meta_description}`` for every published page in a space.

	Doubles as the "is there a page at this route?" lookup that decides whether
	a group is linkable (the README/index case git-sync produces).
	"""
	rows = frappe.get_all(
		"Wiki Document",
		filters={
			"wiki_space": space_name,
			"is_published": 1,
			"is_group": 0,
			"is_external_link": 0,
		},
		fields=["route", "meta_description"],
	)
	return {row.route: row.meta_description for row in rows if row.route}


def _space_summary(root_group: str, pages: dict) -> str | None:
	"""The space's blockquote line: its landing page's meta description.

	Derived rather than a field on Wiki Space — the landing page's description
	is already the space's public one-liner (it is what search engines show for
	the space URL), so there is nothing extra for an editor to fill in.
	"""
	landing = get_first_published_page(root_group)
	return pages.get(landing["route"]) if landing else None


def _render_nodes(nodes: list, pages: dict, depth: int) -> list[str]:
	"""The sidebar tree as a nested markdown list, deepest-first indentation."""
	indent = "  " * depth
	items = []
	for node in nodes:
		items.append(f"{indent}- {_node_entry(node, pages)}")
		items += _render_nodes(node.get("children") or [], pages, depth + 1)
	return items


def _node_entry(node: dict, pages: dict) -> str:
	"""One list entry: a link to the page's markdown, or a bare label."""
	title = node.get("title") or node["name"]
	route = node.get("route")

	if node.get("is_external_link"):
		# Someone else's URL — there is no `.md` twin of it to point at.
		return f"[{title}]({node['external_url']})" if node.get("external_url") else f"**{title}**"

	# A group is served by redirecting to its first child, so it is only worth
	# linking when a page of its own sits at its route.
	if not route or (node.get("is_group") and route not in pages):
		return f"**{title}**"

	entry = f"[{title}]({frappe.utils.get_url('/' + route)}.md)"
	description = pages.get(route)
	return f"{entry}: {description}" if description else entry
