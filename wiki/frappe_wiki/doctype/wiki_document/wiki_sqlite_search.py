import re
from typing import ClassVar

import frappe
from bs4 import BeautifulSoup
from frappe.search.sqlite_search import SQLiteSearch
from frappe.utils import create_batch

from wiki.wiki.markdown import DEFAULT_TITLES, render_markdown

# Frappe v15 inserts a new row on every index_doc and never drops the old one.
INDEX_DOC_APPENDS = int(frappe.__version__.split(".", 1)[0]) < 16


class WikiSQLiteSearch(SQLiteSearch):
	INDEX_NAME = "wiki_search.db"

	INDEX_SCHEMA: ClassVar[dict] = {
		"text_fields": ["title", "content"],
		"metadata_fields": ["doctype", "name", "route", "space", "published", "modified"],
		"tokenizer": "unicode61 remove_diacritics 2 tokenchars '-_'",
	}

	INDEXABLE_DOCTYPES: ClassVar[dict] = {
		"Wiki Document": {
			"fields": [
				"name",
				"title",
				"content",
				"route",
				{"published": "is_published"},
				"modified",
			],
			"filters": {"is_published": 1, "is_group": 0, "is_external_link": 0},
		}
	}

	def get_search_filters(self):
		"""Permission-based filtering - only return published documents"""
		return {"published": 1}

	def prepare_document(self, doc):
		"""Override to compute space and index the text a reader sees"""
		prepared = super().prepare_document(doc)
		if prepared and doc.get("doctype") == "Wiki Document":
			prepared["space"] = self._get_root_space(doc.get("name"))
			prepared["content"] = self._get_reader_text(doc.get("content"))
		return prepared

	def index_doc(self, doctype, docname):
		if INDEX_DOC_APPENDS:
			self.remove_doc(doctype, docname)
		super().index_doc(doctype, docname)

	def _get_reader_text(self, markdown):
		soup = BeautifulSoup(render_markdown(markdown or ""), "html.parser")
		for image in soup.find_all("img"):
			image.replace_with(f" {image.get('alt', '')} ")
		for element in soup.select("noscript, .footnote-backref"):
			element.decompose()
		for title in soup.select(".callout-title"):
			if title.get_text() in DEFAULT_TITLES.values():
				title.decompose()

		# The reader renders snippets as HTML, so code samples must not survive as tags.
		text = re.sub(r"[<>]", " ", soup.get_text(separator=" "))
		return " ".join(text.split()).encode("utf-8", "ignore").decode()

	def _get_root_space(self, docname):
		"""Get the root wiki space for a document"""
		wiki_doc = frappe.get_doc("Wiki Document", docname)
		return wiki_doc.get_root_group() or docname


def enqueue_reindex(docnames: list[str]):
	"""Re-index Wiki Documents after a merge.

	Merge fast paths write content with raw ``frappe.db.set_value``, which
	skips the framework's on_update hook that normally triggers the re-index,
	so without this the search index keeps serving the pre-merge content.

	Goes through ``index_doc`` rather than the framework's queue table: the
	queue only exists on Frappe develop, while ``index_doc`` is present on
	version-16 too (indexing inline there, queueing on develop).
	"""
	search = WikiSQLiteSearch()
	if not (search.is_search_enabled() and search.index_exists()):
		return

	try:
		for docname in docnames:
			search.index_doc("Wiki Document", docname)
	except Exception:
		frappe.log_error(
			title="Wiki Search Reindex Error",
			message=f"Failed to re-index Wiki Documents: {docnames}",
		)


def remove_docs_from_index(docnames: list[str]):
	"""Remove Wiki Documents from the search index immediately.

	The framework's index update path only *queues* a re-index (drained by a
	5-minute scheduler job, 30 docs per run), so an unpublished page would keep
	surfacing in search until the queue catches up. Unpublishing must take
	effect right away, so we delete the rows synchronously.
	"""
	search = WikiSQLiteSearch()
	if not (docnames and search.is_search_enabled() and search.index_exists()):
		return

	doc_ids = [f"Wiki Document:{name}" for name in docnames]
	connection = search._get_connection()
	try:
		# The queue table only exists on Frappe develop.
		tables = ["search_fts"] + [
			row[0]
			for row in connection.execute(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_index_queue'"
			)
		]
		for batch in create_batch(doc_ids, 500):
			placeholders = ", ".join("?" * len(batch))
			for table in tables:
				connection.execute(f"DELETE FROM {table} WHERE doc_id IN ({placeholders})", batch)
		connection.commit()
	except Exception:
		frappe.log_error(
			title="Wiki Search Index Removal Error",
			message=f"Failed to remove {len(docnames)} Wiki Documents from the search index",
		)
	finally:
		connection.close()
