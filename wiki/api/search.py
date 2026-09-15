import frappe

TITLE_SEARCH_LIMIT = 20


@frappe.whitelist()
def search_titles(query: str) -> list[dict]:
	"""Find pages by title across every space the user can read."""
	query = (query or "").strip()
	if not query:
		return []

	return frappe.get_list(
		"Wiki Document",
		filters={
			"title": ("like", f"%{query}%"),
			"is_group": 0,
			"is_external_link": 0,
			"wiki_space": ("is", "set"),
		},
		fields=[
			"name",
			"title",
			"route",
			"is_published",
			"wiki_space",
			"wiki_space.space_name as space_name",
			"wiki_space.route as space_route",
		],
		order_by="modified desc",
		limit=TITLE_SEARCH_LIMIT,
	)
