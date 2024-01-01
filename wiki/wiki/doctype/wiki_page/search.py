# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe.search import web_search
from frappe.utils import strip_html_tags, update_progress_bar
from frappe.utils.redis_wrapper import RedisWrapper

PREFIX = "wiki_page_search_doc"


_redisearch_available = False
try:
	from redis.commands.search.query import Query  # noqa: F401

	_redisearch_available = True
except ImportError:
	pass


@frappe.whitelist(allow_guest=True)
def search(query, path, space):
	if not space:
		space = get_space_route(path)

	use_redisearch = frappe.db.get_single_value("Wiki Settings", "use_redisearch_for_search")
	if not use_redisearch or not _redisearch_available:
		result = web_search(query, space, 5)

		for d in result:
			d.title = d.title_highlights or d.title
			d.route = d.path
			d.content = d.content_highlights

			del d.title_highlights
			del d.content_highlights
			del d.path

		return {"docs": result, "search_engine": "frappe_web_search"}

	from redis.commands.search.query import Query  # noqa: F811
	from redis.exceptions import ResponseError

	# if redisearch enabled use redisearch
	r = frappe.cache()
	query = Query(query).paging(0, 5).highlight(tags=['<b class="match">', "</b>"])

	try:
		result = r.ft(space).search(query)
	except ResponseError:
		return {"docs": [], "search_engine": "redisearch"}

	names = []
	for d in result.docs:
		_, name = d.id.split(":")
		names.append(name)
	names = list(set(names))

	data_by_name = {
		d.name: d
		for d in frappe.db.get_all("Wiki Page", fields=["name"], filters={"name": ["in", names]})
	}

	docs = []
	for d in result.docs:
		_, name = d.id.split(":")
		doc = data_by_name[name]
		doc.title = d.title
		doc.route = d.route
		doc.content = d.content
		docs.append(doc)

	return {"docs": docs, "search_engine": "redisearch"}


def get_space_route(path):
	for space in frappe.db.get_all("Wiki Space", pluck="route"):
		if space in path:
			return space


def rebuild_index():
	from redis.commands.search.field import TextField
	from redis.commands.search.indexDefinition import IndexDefinition
	from redis.exceptions import ResponseError

	r = frappe.cache()
	r.set_value("wiki_page_index_in_progress", True)

	# Options for index creation
	schema = (
		TextField("title", weight=3.0),
		TextField("content"),
	)

	# Create an index and pass in the schema
	spaces = frappe.db.get_all("Wiki Space", pluck="route")
	wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "title", "content", "route"])
	for space in spaces:
		try:
			drop_index(space)

			index_def = IndexDefinition(
				prefix=[f"{r.make_key(f'{PREFIX}{space}').decode()}:"], score=0.5, score_field="doc_score"
			)
			r.ft(space).create_index(schema, definition=index_def)

			records_to_index = [d for d in wiki_pages if space in d.get("route")]
			create_index_for_records(records_to_index, space)
		except ResponseError as e:
			print(e)

	r.set_value("wiki_page_index_in_progress", False)


def rebuild_index_in_background():
	if not frappe.cache().get_value("wiki_page_index_in_progress"):
		print(f"Queued rebuilding of search index for {frappe.local.site}")
		frappe.enqueue(rebuild_index, queue="long")


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
	record = frappe._dict(
		{"name": doc.name, "title": doc.title, "content": doc.content, "route": doc.route}
	)
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


def drop_index(space):
	from redis.exceptions import ResponseError

	try:
		frappe.cache().ft(space).dropindex(delete_documents=True)
	except ResponseError:
		pass
