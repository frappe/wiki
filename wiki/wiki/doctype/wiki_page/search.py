# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe.utils import strip_html_tags, update_progress_bar
from frappe.utils.redis_wrapper import RedisWrapper

from wiki.wiki_search import WikiSearch

PREFIX = "wiki_page_search_doc"
INDEX_BUILD_FLAG = "wiki_page_index_in_progress"


_redisearch_available = False
try:
	from redis.commands.search.query import Query

	_redisearch_available = True
except ImportError:
	pass


@frappe.whitelist(allow_guest=True)
def get_spaces():
	return frappe.db.get_all("Wiki Space", pluck="route")


@frappe.whitelist(allow_guest=True)
def search(
	query: str,
	path: str | None = None,
	space: str | None = None,
):
	if not space and path:
		space = get_space_route(path)

	if frappe.db.get_single_value("Wiki Settings", "use_sqlite_for_search"):
		return sqlite_search(query, space)

	if use_redis_search():
		return redis_search(query, space)

	return web_search(query, space)


def use_redis_search():
	return frappe.db.get_single_value("Wiki Settings", "use_redisearch_for_search") and _redisearch_available


def sqlite_search(query, space):
	from wiki.wiki.doctype.wiki_page.sqlite_search import search

	return {
		"docs": search(query, space),
		"search_engine": "sqlite_fts",
	}


def web_search(query, space):
	from frappe.search import web_search

	result = web_search(query, space)

	for d in result:
		d.title = d.title_highlights or d.title
		d.route = d.path
		d.content = d.content_highlights

		del d.title_highlights
		del d.content_highlights
		del d.path

	return {
		"docs": result,
		"search_engine": "frappe_web_search",
	}


def redis_search(query, space):
	from wiki.wiki_search import WikiSearch

	search = WikiSearch()
	search_query = search.clean_query(query)
	query_parts = search_query.split(" ")

	if len(query_parts) == 1 and not query_parts[0].endswith("*"):
		search_query = f"{query_parts[0]}*"
	if len(query_parts) > 1:
		search_query = " ".join([f"%%{q}%%" for q in query_parts])

	result = search.search(
		f"@title|content:({search_query})",
		space=space,
		start=0,
		sort_by="modified desc",
		highlight=True,
		with_payloads=True,
	)

	docs = []
	for doc in result.docs:
		docs.append(
			{
				"content": doc.content,
				"name": doc.id.split(":", 1)[1],
				"route": doc.route,
				"title": doc.title,
			}
		)

	return {"docs": docs, "search_engine": "redisearch"}


def get_space_route(path):
	for space in frappe.db.get_all("Wiki Space", pluck="route"):
		if space in path:
			return space


def create_index_for_records(records, space):
	r = frappe.cache()
	for i, d in enumerate(records):
		if not hasattr(frappe.local, "request") and len(records) > 10:
			update_progress_bar(f"Indexing Wiki Pages - {space}", i, len(records), absolute=True)

		key = r.make_key(f"{PREFIX}{space}:{d.name}").decode()
		mapping = {
			"title": d.title,
			"content": strip_html_tags(d.content),
			"route": d.route,
		}
		super(RedisWrapper, r).hset(key, mapping=mapping)


def remove_index_for_records(records, space):
	from redis.exceptions import ResponseError

	r = frappe.cache()
	for d in records:
		try:
			key = r.make_key(f"{PREFIX}{space}:{d.name}").decode()
			r.ft(space).delete_document(key)
		except ResponseError:
			pass


def update_index(doc):
	record = frappe._dict({"name": doc.name, "title": doc.title, "content": doc.content, "route": doc.route})
	space = get_space_route(doc.route)

	create_index_for_records([record], space)


def remove_index(doc):
	record = frappe._dict(
		{
			"name": doc.name,
			"route": doc.route,
		}
	)
	space = get_space_route(doc.route)

	remove_index_for_records([record], space)


def drop_index(space: str | None = None):
	if frappe.db.get_single_value("Wiki Settings", "use_sqlite_for_search"):
		from wiki.wiki.doctype.wiki_page.sqlite_search import delete_db

		return delete_db()

	if use_redis_search():
		return WikiSearch().drop_index()

	if not space:
		return

	from redis.exceptions import ResponseError

	try:
		frappe.cache().ft(space).dropindex(delete_documents=True)
	except ResponseError:
		pass


def build_index_in_background():
	if frappe.cache().get_value(INDEX_BUILD_FLAG):
		return

	print(f"Queued rebuilding of search index for {frappe.local.site}")
	frappe.enqueue(build_index, queue="long")


def build_index():
	frappe.cache().set_value(INDEX_BUILD_FLAG, True)

	if frappe.db.get_single_value("Wiki Settings", "use_sqlite_for_search"):
		from wiki.wiki.doctype.wiki_page.sqlite_search import build_index

		return build_index()

	if use_redis_search():
		return WikiSearch().build_index()

	frappe.cache().set_value(INDEX_BUILD_FLAG, False)
