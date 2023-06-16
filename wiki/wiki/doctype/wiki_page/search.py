# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe.utils import strip_html_tags, update_progress_bar
from frappe.utils.redis_wrapper import RedisWrapper
from redis.commands.search.field import TextField
from redis.commands.search.indexDefinition import IndexDefinition
from redis.commands.search.query import Query
from redis.exceptions import ResponseError

PREFIX = "wiki_page_search_doc"


@frappe.whitelist(allow_guest=True)
def search(query, path, space):
	r = frappe.cache()

	if not space:
		space = get_space_route(path)

	query = Query(query).paging(0, 5).highlight(tags=["<mark>", "</mark>"])

	try:
		result = r.ft(space).search(query)
	except ResponseError as e:
		frappe.logger().error(f"Error in search: {e}")
		if str(e).endswith("no such index"):
			rebuild_index_in_background()
		return {"total": 0, "docs": [], "duration": 0}

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

	return {"docs": docs, "total": result.total, "duration": result.duration}


def get_space_route(path):
	for space in frappe.db.get_all("Wiki Space", pluck="route"):
		if space in path:
			return space


def rebuild_index():
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
	try:
		frappe.cache().ft(space).dropindex(delete_documents=True)
	except ResponseError:
		pass
