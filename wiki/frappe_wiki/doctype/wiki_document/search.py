import frappe


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
def search(query: str, space: str | None = None) -> dict:
	"""
	Search wiki documents with space-scoped filtering.

	Args:
	    query: Search query string
	    space: Wiki space (root group) name to scope search

	Returns:
	    Search results with title, content snippets, and scores
	"""
	from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import WikiSQLiteSearch

	if not query or not query.strip():
		return {"results": [], "total": 0}

	search_engine = WikiSQLiteSearch()
	filters = {"space": space} if space else {}

	result = search_engine.search(query, filters=filters)

	hits = _filter_hits_by_read_access(result["results"])

	return {
		"results": [
			{
				"name": r["name"],
				"title": r["title"],
				"route": r.get("route", ""),
				"content": r["content"],
				"score": r["score"],
			}
			for r in hits
		],
		"total": len(hits),
	}


def _filter_hits_by_read_access(hits: list[dict]) -> list[dict]:
	"""Drop search hits in spaces the current user can't read.

	The SQLite index is built without user context, so titles/snippets from
	restricted spaces can surface here. Resolve each hit's denormalized
	wiki_space and gate it through the same read check as page rendering.
	Orphan documents (no wiki_space) stay readable by all.
	"""
	from wiki.permissions import can_read_space

	names = [hit["name"] for hit in hits]
	if not names:
		return hits

	space_by_name = {
		row.name: row.wiki_space
		for row in frappe.get_all(
			"Wiki Document",
			filters={"name": ("in", names)},
			fields=["name", "wiki_space"],
		)
	}

	readable: dict[str, bool] = {}

	def _can_read(space_name: str) -> bool:
		if space_name not in readable:
			readable[space_name] = can_read_space(space_name)
		return readable[space_name]

	allowed = []
	for hit in hits:
		hit_space = space_by_name.get(hit["name"])
		if not hit_space or _can_read(hit_space):
			allowed.append(hit)
	return allowed
