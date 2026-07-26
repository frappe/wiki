# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""sitemap.xml, with wiki routes in it.

frappe's own sitemap (frappe/www/sitemap.py) walks doctypes that have a web
view, guest view enabled, and a published field. Wiki Document has none of
those -- it renders through a page_renderer -- so no wiki route has ever been
listed. This rebuilds the framework's list and adds the wiki's own routes to it,
so taking over the route loses nothing that was there before.
"""

from urllib.parse import quote
from xml.sax.saxutils import escape

import frappe
from frappe.utils import get_url, nowdate
from frappe.website.router import get_pages
from frappe.www.sitemap import get_public_pages_from_doctypes

from wiki.wiki.crawler_cache import SITEMAP, cached_index
from wiki.wiki.llms_txt import public_spaces


def build_sitemap_xml() -> str | None:
	"""The site's sitemap, or None when the wiki has nothing public to add.

	Returning None leaves /sitemap.xml to the framework, so installing this app
	on a site with no public wiki changes nothing.
	"""
	return cached_index(SITEMAP, _sitemap_xml)


def _sitemap_xml() -> str | None:
	wiki_links = _wiki_links()
	if not wiki_links:
		return None

	# Framework links first (the site's own pages), then the wiki's, deduped by
	# URL so a route both sides know about is listed once.
	links = {}
	for loc, lastmod in _framework_links() + wiki_links:
		links[loc] = lastmod

	entries = "\n".join(
		f"\t<url>\n\t\t<loc>{escape(loc)}</loc>\n\t\t<lastmod>{lastmod}</lastmod>\n\t</url>"
		for loc, lastmod in links.items()
	)
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n'
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
		f"{entries}\n"
		"</urlset>\n"
	)


def _wiki_links() -> list[tuple[str, str]]:
	"""Published pages in Guest-readable spaces, as (url, lastmod) pairs.

	`.md` variants are deliberately absent: they are the same page in another
	representation, which is duplicate content to a search engine.
	"""
	spaces = [space.name for space in public_spaces()]
	if not spaces:
		return []

	pages = frappe.get_all(
		"Wiki Document",
		filters={
			"wiki_space": ["in", spaces],
			"is_published": 1,
			"is_group": 0,
			"is_external_link": 0,
		},
		fields=["route", "modified"],
		ignore_permissions=True,
	)
	return [
		(get_url(quote(page.route.encode("utf-8"))), f"{page.modified:%Y-%m-%d}")
		for page in pages
		if page.route
	]


def _framework_links() -> list[tuple[str, str]]:
	"""Exactly what frappe.www.sitemap would have emitted on its own."""
	links = [
		(get_url(quote(page.name.encode("utf-8"))), nowdate())
		for page in get_pages().values()
		if page.sitemap
	]
	links += [
		(get_url(quote((route or "").encode("utf-8"))), f"{data['modified']:%Y-%m-%d}")
		for route, data in get_public_pages_from_doctypes().items()
	]
	return links
