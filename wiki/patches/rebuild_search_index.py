import frappe


def execute():
	frappe.enqueue(
		"wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search.rebuild_index",
		queue="long",
		timeout=2 * 60 * 60,
		enqueue_after_commit=True,
	)
