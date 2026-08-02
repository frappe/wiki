# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Redis cache for the crawler indexes (llms.txt, sitemap.xml).

Each index walks every public space's tree, which is far more work than a page
render, and the result is the same for every visitor -- they are built as Guest
by construction. So they are cached whole and dropped on any wiki write, the
same way the sidebar tree is.
"""

import frappe

CACHE_KEY = "wiki_crawler_index"

SITE_LLMS_TXT = "llms-txt:__site__"
SITEMAP = "sitemap"


def space_llms_txt_key(space: str) -> str:
	return f"llms-txt:{space}"


def cached_index(key: str, build) -> str | None:
	"""Return a cached index body, building it on a miss.

	"No index for this key" is cached as an empty string rather than skipped,
	so a crawler hammering a route that has nothing to serve doesn't rebuild
	the answer every time.
	"""
	cache = frappe.cache()
	body = cache.hget(CACHE_KEY, key)
	if body is None:
		body = build() or ""
		cache.hset(CACHE_KEY, key, body)
	return body or None


def clear_crawler_cache(doc=None, method=None):
	"""Drop every cached index.

	Cleared wholesale because one page can move between spaces, and the space
	list itself sits in the site index. Cleared again after commit to close the
	race where another worker re-caches from pre-commit state -- same reasoning
	as clear_wiki_tree_cache, which calls this.
	"""
	frappe.cache().delete_value(CACHE_KEY)
	frappe.db.after_commit.add(lambda: frappe.cache().delete_value(CACHE_KEY))
