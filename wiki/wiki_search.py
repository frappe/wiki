# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

import re

import frappe
from frappe.utils import cstr, strip_html_tags, update_progress_bar
from frappe.utils.redis_wrapper import RedisWrapper

from wiki.search import Search

UNSAFE_CHARS = re.compile(r"[\[\]{}<>+]")

INDEX_BUILD_FLAG = "wiki_page_index_in_progress"


class WikiSearch(Search):
	def __init__(self) -> None:
		schema = [
			{"name": "title", "weight": 5},
			{"name": "content", "weight": 2},
			{"name": "route", "type": "tag"},
			{"name": "meta_description", "weight": 1},
			{"name": "meta_keywords", "weight": 3},
			{"name": "modified", "sortable": True},
		]
		super().__init__("wiki_idx", "wiki_search_doc", schema)

	def search(self, query, space=None, **kwargs):
		if query and space:
			query = rf"{query} @route:{{{space}\/*}}"
		return super().search(query, **kwargs)

	def build_index(self):
		self.drop_index()
		self.create_index()
		records = self.get_records()
		total = len(records)
		for i, doc in enumerate(records):
			self.index_doc(doc)
			if not hasattr(frappe.local, "request"):
				update_progress_bar("Indexing Wiki Pages", i, total)
		if not hasattr(frappe.local, "request"):
			print()

	def index_doc(self, doc):
		id = f"Wiki Page:{doc.name}"
		fields = {
			"title": doc.title,
			"content": strip_html_tags(doc.content),
			"route": doc.route,
			"meta_description": doc.meta_description or "",
			"meta_keywords": doc.meta_keywords or "",
			"modified": doc.modified,
		}
		payload = {
			"route": doc.route,
			"published": doc.published,
			"allow_guest": doc.allow_guest,
		}
		self.add_document(id, fields, payload=payload)

	def remove_doc(self, doc):
		if doc.doctype == "Wiki Page":
			id = f"Wiki Page:{doc.name}"
			self.remove_document(id)

	def clean_query(self, query):
		query = query.strip().replace("-*", "*")
		query = UNSAFE_CHARS.sub(" ", query)
		query = query.strip()
		return query

	def get_records(self):
		return frappe.get_all(
			"Wiki Page",
			fields=[
				"name",
				"title",
				"content",
				"route",
				"meta_description",
				"meta_keywords",
				"modified",
				"published",
				"allow_guest",
			],
			filters={"published": 1},
		)
