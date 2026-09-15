import frappe

PAGE_SEARCH_LIMIT = 20


@frappe.whitelist()
def search_pages(query: str) -> list[dict]:
	"""Find pages by URL across every space the user can read."""
	query = (query or "").strip()
	if not query:
		return []

	# Routes hyphenate words, so "getting started" still finds `getting-started`.
	# The slash skips the space's own segment, which every page in it shares.
	route = query.replace(" ", "-")
	return frappe.get_list(
		"Wiki Document",
		filters={
			"route": ("like", f"%/%{route}%"),
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
		limit=PAGE_SEARCH_LIMIT,
	)
