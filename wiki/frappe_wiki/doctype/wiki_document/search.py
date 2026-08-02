import frappe


@frappe.whitelist()
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

	hits = _filter_hits_by_space_visibility(result["results"])

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


def _filter_hits_by_space_visibility(hits: list[dict]) -> list[dict]:
	"""Drop search hits the current user couldn't open as a page.

	The SQLite index is built without user context, so titles/snippets from
	restricted spaces can surface here. Resolve each hit's denormalized
	wiki_space and gate it through the same checks as page rendering: the
	space must be published (`check_published`) and readable by the current
	user (`check_space_access`). Orphan documents (no wiki_space) stay
	readable by all, subject to the same document-level Owner Only check.
	"""
	from wiki.permissions import _document_owner_only_blocks, _is_manager, can_read_space

	names = [hit["name"] for hit in hits]
	if not names:
		return hits

	doc_by_name = {
		row.name: row
		for row in frappe.get_all(
			"Wiki Document",
			filters={"name": ("in", names)},
			fields=["name", "wiki_space", "owner_only", "owner"],
		)
	}

	visible: dict[str, bool] = {}

	def _is_visible(space_name: str) -> bool:
		if space_name not in visible:
			space_published = frappe.get_cached_value("Wiki Space", space_name, "is_published")
			visible[space_name] = bool(space_published) and can_read_space(space_name)
		return visible[space_name]

	is_manager = _is_manager()

	allowed = []
	for hit in hits:
		doc = doc_by_name.get(hit["name"])
		if not doc:
			continue
		if _document_owner_only_blocks(doc, frappe.session.user) and not is_manager:
			continue
		if not doc.wiki_space or _is_visible(doc.wiki_space):
			allowed.append(hit)
	return allowed
