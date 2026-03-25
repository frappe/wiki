import re
from typing import ClassVar

import frappe
from frappe.search.sqlite_search import SQLiteSearch


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
		"""Override to compute space and strip markdown from content"""
		prepared = super().prepare_document(doc)
		if prepared and doc.get("doctype") == "Wiki Document":
			prepared["space"] = self._get_root_space(doc.get("name"))
			if prepared.get("content"):
				prepared["content"] = self._strip_markdown(prepared["content"])
		return prepared

	def _strip_markdown(self, text):
		"""Convert markdown to plain text for cleaner search indexing"""
		if not text:
			return text

		# Remove code blocks (``` ... ```)
		text = re.sub(r"```[\s\S]*?```", " ", text)

		# Remove inline code (`code`)
		text = re.sub(r"`[^`]+`", " ", text)

		# Remove custom directives (:::note, :::danger, etc.)
		text = re.sub(r":::[a-z]+\s*", " ", text)
		text = re.sub(r":::\s*", " ", text)

		# Remove images ![alt](url)
		text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)

		# Convert links [text](url) to just text
		text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

		# Remove headers (# ## ### etc.)
		text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)

		# Remove bold/italic markers
		text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
		text = re.sub(r"_{1,3}([^_]+)_{1,3}", r"\1", text)

		# Remove blockquotes
		text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)

		# Remove horizontal rules
		text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)

		# Remove HTML tags
		text = re.sub(r"<[^>]+>", " ", text)

		# Collapse multiple whitespace/newlines
		text = re.sub(r"\s+", " ", text)

		return text.strip()

	def _get_root_space(self, docname):
		"""Get the root wiki space for a document"""
		wiki_doc = frappe.get_doc("Wiki Document", docname)
		return wiki_doc.get_root_group() or docname
