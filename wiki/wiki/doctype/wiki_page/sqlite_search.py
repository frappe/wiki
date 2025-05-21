from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

import frappe


def delete_db():
	"""Delete the index"""
	Path(_get_index_path()).unlink()


def search(query: str, space: str | None = None) -> list[dict[str, Any]]:
	"""Search the index for the given query and return the results"""
	conn = sqlite3.connect(_get_index_path())
	cursor = conn.cursor()

	_set_pragmas(cursor)

	search_query = """
		SELECT
			s.name,
			snippet(search_fts, 1, '<|', '|>', '...', 64) as title,
			snippet(search_fts, 2, '<|', '|>', '...', 64) as content,
			s.route,
			s.modified,
			rank
		FROM search_index s
		JOIN search_fts fts ON s.name = fts.name
		WHERE search_fts MATCH ?
	"""

	query = _clean_query(query)
	params = [query]

	# Add space filter if provided
	if space:
		search_query += " AND s.space = ?"
		params.append(space)

	search_query += " ORDER BY rank"

	cursor.execute(search_query, params)
	results = []

	for row in cursor.fetchall():
		results.append(
			{
				"name": row[0],
				"title": row[1],
				"content": row[2],
				"route": row[3],
				# Fields below are used for re-ranking
				"modified": row[4],
				"rank": row[5],
				"is_title_match": "<|" in row[1],
				"is_content_match": "<|" in row[2],
				"exact_match_in_title": _has_exact_match(row[1], query),
				"exact_match_in_content": _has_exact_match(row[2], query),
			}
		)

	conn.close()
	return _rerank_and_clean(results)


def _rerank_and_clean(results: list[dict]):
	for r in results:
		r["title"] = r["title"].replace("<|", "<b class='match'>").replace("|>", "</b>")
		r["content"] = r["content"].replace("<|", "<b class='match'>").replace("|>", "</b>")

		del r["exact_match_in_title"]
		del r["exact_match_in_content"]
		del r["rank"]
		del r["modified"]
		del r["is_title_match"]
		del r["is_content_match"]

	# TODO: add re-ranking

	return results


def _has_exact_match(snippet: str, query: str) -> bool:
	"""Check all consecutive matches against the query string, uses smart case matching"""
	has_upper = any(i.isupper() for i in query)  # exact match only if case matches
	query_splits = query.strip().split()
	snippet_splits = snippet.split()

	for snippet_index in range(len(snippet_splits)):
		if not re.match(r".*<\|(.*?)\|>.*", snippet_splits[snippet_index]):
			continue

		query_index = 0
		while snippet_index < len(snippet_splits):
			if query_index >= len(query_splits) or not (
				match := re.match(r".*<\|(.*?)\|>.*", snippet_splits[snippet_index])
			):
				break

			qs = query_splits[query_index]
			ss = match.group(1)

			if not has_upper:
				ss = ss.lower()
				qs = qs.lower()

			is_match = qs == ss
			if qs.endswith("*"):
				is_match = ss.startswith(qs[:-1])

			if not is_match:
				break

			query_index += 1
			snippet_index += 1

			if query_index == len(query_splits):
				return True

	return False


def _clean_query(query: str) -> str:
	query = " ".join(query.strip().split())
	if not query.endswith("*"):
		query += "*"
	return query


def build_index():
	"""If index already exists, drop it and create a new one"""
	conn = sqlite3.connect(_get_index_path())
	cursor = conn.cursor()
	_set_pragmas(cursor)

	cursor.execute("DROP TABLE IF EXISTS search_index")
	cursor.execute("""
		CREATE TABLE search_index (
			name TEXT PRIMARY KEY,
			title TEXT,
			content TEXT,
			route TEXT,
			space TEXT,
			modified TEXT
		)
	""")
	cursor.execute("""
		CREATE VIRTUAL TABLE search_fts USING fts5(
			name UNINDEXED,
			title,
			content,
			tokenize='porter unicode61',
		)
	""")

	for doc in _get_index_items():
		_add_to_index(doc, cursor)

	conn.commit()
	conn.close()


def _set_pragmas(cursor: sqlite3.Cursor):
	cursor.execute("PRAGMA journal_mode = WAL;")
	cursor.execute("PRAGMA synchronous = NORMAL;")
	cursor.execute("PRAGMA cache_size = -8192;")  # 8MB cache
	cursor.execute("PRAGMA temp_store = MEMORY;")


def _get_index_path():
	site_path = Path(frappe.get_site_path())
	index_path = site_path / "indexes" / "wiki_page_search_index.db"
	return index_path.absolute()


def _clean_content(text: str) -> str:
	"""Remove markdown formatting from text"""
	# Remove headers
	text = re.sub(r"#{1,6}\s+", "", text)
	# Remove bold/italic
	text = re.sub(r"[*_]{1,2}(.*?)[*_]{1,2}", r"\1", text)
	# Remove links
	text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
	# Remove code blocks
	text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
	# Remove inline code
	text = re.sub(r"`([^`]+)`", r"\1", text)
	# Remove lists
	text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
	# Remove blockquotes
	text = re.sub(r"^\s*>\s+", "", text, flags=re.MULTILINE)
	return text.strip()


def _add_to_index(doc: dict[str, Any], cursor: sqlite3.Cursor):
	"""Add a document to the search index"""
	# Clean markdown from content
	cleaned_content = _clean_content(doc["content"])

	# Insert into main table
	cursor.execute(
		"""
		INSERT OR REPLACE INTO search_index
		(name, title, content, route, space, modified)
		VALUES (?, ?, ?, ?, ?, ?)
	""",
		(
			doc["name"],
			doc["title"],
			doc["content"],  # Store original content
			doc["route"],
			doc["space"],
			doc["modified"],
		),
	)

	# Insert into FTS table
	cursor.execute(
		"""
		INSERT OR REPLACE INTO search_fts
		(name, title, content)
		VALUES (?, ?, ?)
	""",
		(
			doc["name"],
			doc["title"],
			cleaned_content,  # Use cleaned content for search
		),
	)


def _get_index_items():
	spaces = {
		i.name: i.route
		for i in frappe.get_all(
			"Wiki Space",
			fields=["name", "route"],
		)
	}

	sidebar_items = {
		i.wiki_page: spaces[i.parent]
		for i in frappe.get_all(
			"Wiki Group Item",
			fields=["parent", "wiki_page"],
		)
	}

	pages = frappe.get_all(
		"Wiki Page",
		fields=[
			"name",
			"title",
			"content",
			"route",
			"modified",
		],
		filters={"published": 1},
	)

	for i in pages:
		i["space"] = sidebar_items.get(i.name, None)
		i["modified"] = i["modified"].isoformat()

	return pages
