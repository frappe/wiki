# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""llms.txt generation — an index of a wiki, written for LLM crawlers.

Follows the llmstxt.org format: an H1, an optional blockquote summary, then H2
sections containing nothing but markdown lists of links.

Everything here is generated from the *published, Guest-readable* wiki only, and
never from the requesting session — see wiki/wiki/crawler_renderer.py for why.
"""

import re

import frappe
from frappe import _

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import (
	get_first_published_page,
	get_public_wiki_tree,
)
from wiki.permissions import can_read_space
from wiki.wiki.crawler_cache import SITE_LLMS_TXT, cached_index, space_llms_txt_key

MARKDOWN_HINT = "Append `.md` to any URL below for that page's raw markdown source."

SITE_HINT = (
	"Each space below links to its own llms.txt index. Append `.md` to any page "
	"URL on this site to get that page's raw markdown source."
)


def build_site_llms_txt() -> str | None:
	"""The site-wide llms.txt: one entry per publicly readable Wiki Space.

	Returns None when the site has no such space, so the route can 404 instead
	of publishing an empty index.
	"""
	return cached_index(SITE_LLMS_TXT, _site_llms_txt)


def _site_llms_txt() -> str | None:
	entries = []
	for space in public_spaces():
		landing = get_first_published_page(space.root_group)
		if not landing:
			# No page to read: the space's own index would be empty too.
			continue

		url = f"{frappe.utils.get_url('/' + space.route)}/llms.txt"
		entry = f"- [{_label(space.space_name or space.name)}]({url})"
		description = _one_line(
			frappe.db.get_value("Wiki Document", {"route": landing["route"]}, "meta_description")
		)
		entries.append(f"{entry}: {description}" if description else entry)

	if not entries:
		return None

	title = _one_line(frappe.db.get_single_value("Website Settings", "app_name")) or frappe.local.site
	lines = [f"# {title}", "", SITE_HINT, "", "## Spaces", "", *entries]
	return "\n".join(lines) + "\n"


def public_spaces() -> list:
	"""Published spaces a Guest may read, in the order the space switcher lists them."""
	spaces = frappe.get_all(
		"Wiki Space",
		filters={"is_published": 1},
		fields=["name", "space_name", "route", "root_group"],
		order_by="switcher_order asc, space_name asc",
		ignore_permissions=True,
	)
	roots = [space.root_group for space in spaces if space.root_group]
	# A space whose root group was deleted has no tree to walk, and walking it
	# raises -- which would take the whole site index down over one bad space.
	live_roots = set(frappe.get_all("Wiki Document", filters={"name": ["in", roots]}, pluck="name"))

	return [
		space
		for space in spaces
		if space.route and space.root_group in live_roots and can_read_space(space.name, "Guest")
	]


def build_space_llms_txt(space: str) -> str | None:
	"""The llms.txt index for one Wiki Space, or None when it has no published pages.

	Sections mirror the space's tabs, and each section's list mirrors the
	sidebar tree — same source, so this index can never advertise a page the
	reader doesn't show.
	"""
	return cached_index(space_llms_txt_key(space), lambda: _space_llms_txt(space))


def _space_llms_txt(space: str) -> str | None:
	space_doc = frappe.db.get_value(
		"Wiki Space",
		space,
		["name", "space_name", "route", "root_group", "home_tab_title"],
		as_dict=True,
	)
	# A root group that was deleted leaves nothing to walk, and walking it raises.
	if not space_doc or not space_doc.root_group:
		return None
	if not frappe.db.exists("Wiki Document", space_doc.root_group):
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
		sections.append((_one_line(space_doc.home_tab_title) or _("Home"), untabbed))
	sections += [
		(_one_line(node["title"]), node.get("children") or []) for node in tree if node.get("is_tab")
	]

	body = []
	for title, nodes in sections:
		items = _render_nodes(nodes, pages, depth=0)
		if items:
			body += ["", f"## {title}", "", *items]

	if not body:
		return None

	lines = [f"# {_one_line(space_doc.space_name) or space_doc.name}", ""]
	summary = _one_line(_space_summary(space_doc.root_group, pages))
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
	title = _label(node.get("title") or node["name"])
	route = node.get("route")

	if node.get("is_external_link"):
		# Someone else's URL — there is no `.md` twin of it to point at. Angle
		# brackets keep a destination with parentheses in it from ending the link.
		url = _one_line(node.get("external_url")).replace("<", "").replace(">", "")
		return f"[{title}](<{url}>)" if url else f"**{title}**"

	# A group is served by redirecting to its first child, so it is only worth
	# linking when a page of its own sits at its route.
	if not route or (node.get("is_group") and route not in pages):
		return f"**{title}**"

	entry = f"[{title}]({frappe.utils.get_url('/' + route)}.md)"
	description = _one_line(pages.get(route))
	return f"{entry}: {description}" if description else entry


def _one_line(text: str | None) -> str:
	"""Collapse a title or description onto one line.

	Both are editor-controlled and both are free text: a newline in either would
	end the list item it sits in and turn the rest into new entries.
	"""
	return " ".join((text or "").split())


def _label(text: str | None) -> str:
	"""A link label that cannot escape its own brackets.

	`[` / `]` in a title would otherwise re-point the link at whatever follows,
	which is a real redirect primitive when the reader is a crawler.
	"""
	return re.sub(r"([\\\[\]])", r"\\\1", _one_line(text))
