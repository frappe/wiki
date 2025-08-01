from __future__ import annotations

import contextlib
import re
import sqlite3
from pathlib import Path
from typing import Any

import frappe


def delete_db():
	"""Delete the index"""
	with contextlib.suppress(FileNotFoundError):
		Path(_get_index_path()).unlink()


def search(query: str, space: str | None = None) -> list[dict[str, Any]]:
	"""Search the index for the given query and return the results"""
	index_path = _get_index_path()
	if not index_path.exists():
		build_index()

	with contextlib.closing(sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)) as conn:
		return _search(conn.cursor(), query, space)


def _search(cursor: sqlite3.Cursor, query: str, space: str | None = None) -> list[dict[str, Any]]:
	_set_pragmas(cursor, is_read=True)

	search_query = """
		SELECT
			s.name,
			snippet(search_fts, 1, '<|', '|>', '...', 16) as title,
			snippet(search_fts, 2, '<|', '|>', '...', 16) as content,
			s.route,
			s.modified,
			rank,
			fts.title as title_raw,
			fts.content as content_raw
		FROM search_index s
		JOIN search_fts fts ON s.name = fts.name
		WHERE search_fts MATCH ?
	"""

	cleaned_query, has_boolean_ops = _clean_query(query)
	params = [cleaned_query]

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
				"title_raw": row[6],
				"content_raw": row[7],
			}
		)

	return _rerank_and_clean(query, results, not has_boolean_ops)


def _rerank_and_clean(query: str, results: list[dict], check_match: bool):
	if query.startswith('"') and query.endswith('"') and '"' not in query[1:-1]:
		query = query[1:-1]

	if check_match:
		query_lower = query.lower()
		match_case = any(w.isupper() for w in query)
		results = sorted(
			results,
			key=lambda x: _rank_score(
				x,
				query,
				query_lower,
				match_case,
			),
		)

	for r in results:
		r["title"] = r["title"].replace("<|", "<b class='match'>").replace("|>", "</b>")
		r["content"] = r["content"].replace("<|", "<b class='match'>").replace("|>", "</b>")

		del r["rank"]
		del r["modified"]
		del r["is_title_match"]
		del r["is_content_match"]
		del r["title_raw"]
		del r["content_raw"]

	return results


def _rank_score(
	item: dict,
	query: str,
	query_lower: str,
	match_case: bool,
) -> tuple[float, float]:
	"""
	Uses some sensible heuristics to return a ranking score depending on the
	nature of the match
	"""

	# Title match heuristics
	if query == item["title_raw"]:
		return (-10, item["rank"])

	if query_lower == item["title_raw"].lower():
		return (-9, item["rank"])

	if query in item["title_raw"]:
		return (-8, item["rank"])

	if query_lower in item["title_raw"].lower():
		return (-7, item["rank"])

	if _has_exact_match(item["title"], query, match_case):
		return (-6, item["rank"])

	# Content match heuristics
	if query == item["content_raw"]:
		return (-5, item["rank"])

	if query_lower == item["content_raw"].lower():
		return (-4, item["rank"])

	if query in item["content_raw"]:
		return (-3, item["rank"])

	if query_lower in item["content_raw"].lower():
		return (-2, item["rank"])

	if _has_exact_match(item["content"], query, match_case):
		return (-1, item["rank"])

	return (0, item["rank"])


def _has_exact_match(snippet: str, query: str, match_case: bool) -> bool:
	"""Check all consecutive matches against the query string, uses smart case matching"""
	# Used for smart case matching, i.e. match case only if query has upper case
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

			if not match_case:
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


def _clean_query(query: str) -> tuple[str, bool]:
	"""
	Cleans query while preserving boolean operators, exact matches and internal
	prefix searches. For example:
	- auto prefix:             'hello world'       -> '"hello" "world"*'
	- escape unsafe:           'hello wor"ld'      -> '"hello" "wor""ld"*'
	- exact matches:           '"hello world"'     -> '"hello world"'
	- preserve prefix:         'hello world*'      -> '"hello" "world"*'
	- allow boolean ops:       'hello AND world'   -> '"hello" AND "world"'
	- preserve inner prefix:   'hello* world'      -> '"hello"* "world"'
	- boolean ops with prefix: 'hello* AND world*' -> '"hello"* AND "world"*'
	"""

	# exact match if wrapped in double quotes and no inner dqs
	if query.startswith('"') and query.endswith('"') and '"' not in query[1:-1]:
		return query, False

	# Check for boolean operators and escape special characters if present
	flags = dict(has_inner_prefix=False, has_boolean_ops=False)

	def escape(word):
		"""escape non boolean operator words while preserving ending '*'"""
		if word in {"AND", "OR", "NOT"}:
			flags["has_boolean_ops"] = True
			return word

		suffix = ""
		if word.endswith("*"):
			word = word[:-1]
			suffix = "*"
			flags["has_inner_prefix"] = True

		if word.startswith('"') and word.endswith('"'):
			word = word[1:-1]

		word = word.replace('"', '""')  # escape internal double quotes
		return f'"{word}"{suffix}'

	# escape words while preserving boolean operators
	escaped_words = [escape(w) for w in query.strip().split()]
	query = " ".join(escaped_words)

	if flags["has_boolean_ops"] or flags["has_inner_prefix"]:
		return query, False

	return f"{query}*", flags["has_boolean_ops"]


def build_index():
	"""Create new db with search index and replace existing one"""
	temp_path = _get_index_path(is_temp=True)
	if temp_path.exists():
		temp_path.unlink()

	with contextlib.closing(sqlite3.connect(temp_path)) as conn:
		cursor = conn.cursor()
		_set_pragmas(cursor, is_read=False)

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
				tokenize="unicode61 remove_diacritics 2 tokenchars '-_'",
			)
		""")

		for doc in _get_index_items():
			_add_to_index(doc, cursor)

		conn.commit()

	actual = _get_index_path()
	if actual.exists():
		actual.unlink()

	temp_path.rename(actual)


def _set_pragmas(cursor: sqlite3.Cursor, is_read: bool):
	cursor.execute("PRAGMA journal_mode = WAL;")
	cursor.execute("PRAGMA synchronous = NORMAL;")
	cursor.execute("PRAGMA cache_size = -8192;")  # 8MB cache
	cursor.execute("PRAGMA temp_store = MEMORY;")
	if is_read:
		cursor.execute("PRAGMA query_only = 1;")


def _get_index_path(is_temp: bool = False):
	site_path = Path(frappe.get_site_path())
	indexes_dir = site_path / "indexes"
	if not indexes_dir.exists():
		indexes_dir.mkdir()

	index_path = indexes_dir / "wiki_page_search_index.db"
	if is_temp:
		index_path = index_path.with_suffix(".temp.db")

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
			_clean_content(doc["content"]),  # Use cleaned content for search
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
