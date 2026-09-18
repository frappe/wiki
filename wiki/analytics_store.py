# Copyright (c) 2026, Frappe and Contributors
# For license information, please see license.txt

"""DuckDB mirror of `Web Page View`, and the aggregate queries the dashboard runs against it.

MariaDB stays the source of truth: this is a derived cache that a cron refills, and it can be
deleted at any time. The counting lives here because the numbers are columnar work -- grouped
counts and a first-view window over the whole log -- that MariaDB did badly enough to need a
rollup table, an extra index and a response cache to stay usable.
"""

import os
import time
from datetime import date

import duckdb
import frappe

TABLE = "web_page_views"
DERIVED = "page_views"
FIELDS = ["name", "creation", "path", "referrer", "visitor_id"]
PAGE_SIZE = 20000
INSERT_CHUNK = 1000
INTERVALS = {"daily": "day", "weekly": "week", "monthly": "month"}


def database_path() -> str:
	return os.path.join(frappe.get_site_path(), "wiki_analytics.duckdb")


SCHEMA = (
	f"""
	CREATE TABLE IF NOT EXISTS {TABLE} (
		name VARCHAR PRIMARY KEY,
		creation TIMESTAMP,
		path VARCHAR,
		referrer VARCHAR,
		visitor_id VARCHAR
	)
	""",
	f"""
	CREATE TABLE IF NOT EXISTS {DERIVED} (
		creation TIMESTAMP,
		path VARCHAR,
		referrer_host VARCHAR,
		is_new_visitor INTEGER
	)
	""",
)

DERIVE = f"""
	CREATE OR REPLACE TABLE {DERIVED} AS
	SELECT
		creation,
		path,
		CASE
			WHEN referrer LIKE '%://%' THEN split_part(split_part(referrer, '://', 2), '/', 1)
			ELSE ''
		END AS referrer_host,
		CAST(
			visitor_id <> ''
			AND row_number() OVER (PARTITION BY visitor_id ORDER BY creation, name) = 1
			AS INTEGER
		) AS is_new_visitor
	FROM {TABLE}
"""


def apply_schema(db) -> None:
	for statement in SCHEMA:
		db.execute(statement)


def _open(read_only: bool, retries: int = 8, retry_delay: float = 0.25):
	"""Connect to the site's analytics file, retrying while another process holds the lock.

	DuckDB takes a single cross-process file lock: concurrent read-only connections coexist,
	but a read-write one is exclusive. Queries open read-only so dashboard requests don't lock
	each other out, and both kinds retry to ride out the lock held by the ingestion job.
	"""
	for attempt in range(retries):
		try:
			return duckdb.connect(database_path(), read_only=read_only)
		except duckdb.IOException as e:
			if "lock" not in str(e).lower() or attempt == retries - 1:
				raise
			time.sleep(retry_delay)


class writer:
	"""Read-write connection with the schema in place."""

	def __enter__(self):
		self.db = _open(read_only=False)
		apply_schema(self.db)
		return self.db

	def __exit__(self, *exc):
		self.db.close()


class reader:
	"""Read-only connection. Creates the file first if no ingestion has ever run, since
	DuckDB cannot open a missing database read-only."""

	def __enter__(self):
		if not os.path.exists(database_path()):
			with writer():
				pass
		self.db = _open(read_only=True)
		return self.db

	def __exit__(self, *exc):
		self.db.close()


def ingest() -> int:
	"""Mirror `Web Page View` rows from the newest second already held, and return how many
	rows that added.

	The whole of that second is re-read rather than skipped past: `Web Page View` names are
	random, so a row logged in the same second as the high-water mark can sort before it, and
	paging past it would lose the row for good. Re-offered rows cost a primary key conflict.

	Rows older than the mark are never looked at, so a backdated `creation` is invisible to
	this path. A backfill, or a test that backdates rows, has to call `rebuild` instead.
	"""
	with writer() as db:
		since = db.execute(f"SELECT MAX(creation) FROM {TABLE}").fetchone()[0]
		copied = _copy_rows(db, since)
		mirrored, derived = db.execute(
			f"SELECT (SELECT COUNT(*) FROM {TABLE}), (SELECT COUNT(*) FROM {DERIVED})"
		).fetchone()
		if copied or mirrored != derived:
			db.execute(DERIVE)
		return copied


def rebuild() -> int:
	"""Empty the mirror and copy the whole log back in."""
	with writer() as db:
		db.execute(f"DROP TABLE IF EXISTS {DERIVED}")
		db.execute(f"DROP TABLE IF EXISTS {TABLE}")
		apply_schema(db)
		copied = _copy_rows(db, None)
		db.execute(DERIVE)
		return copied


def _copy_rows(db, since) -> int:
	columns = ", ".join(FIELDS)
	marks = "?, TRY_CAST(? AS TIMESTAMP), ?, ?, COALESCE(?, '')"
	selected = ", ".join(f"`{field}`" for field in FIELDS)
	held_before = db.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
	cursor = None

	db.begin()
	while True:
		if cursor:
			where, values = "WHERE creation > %s OR (creation = %s AND name > %s)", (*cursor[:1], *cursor)
		elif since:
			where, values = "WHERE creation >= %s", (since,)
		else:
			where, values = "", ()

		rows = frappe.db.sql(
			f"SELECT {selected} FROM `tabWeb Page View` {where} ORDER BY creation, name LIMIT {PAGE_SIZE}",
			values,
		)
		if not rows:
			break

		for start in range(0, len(rows), INSERT_CHUNK):
			batch = rows[start : start + INSERT_CHUNK]
			placeholders = ", ".join([f"({marks})"] * len(batch))
			db.execute(
				f"INSERT OR IGNORE INTO {TABLE} ({columns}) VALUES {placeholders}",
				[field for row in batch for field in row],
			)
		if len(rows) < PAGE_SIZE:
			break
		cursor = (rows[-1][FIELDS.index("creation")], rows[-1][FIELDS.index("name")])
	db.commit()

	return db.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0] - held_before


def ingest_recent_views() -> None:
	"""Scheduled entry point."""
	if count := ingest():
		frappe.logger().info(f"Mirrored {count} Web Page View rows into DuckDB")


def known_paths() -> list[str]:
	"""Every path in the log, for resolving which of them sit under a space's route."""
	with reader() as db:
		rows = db.execute(f"SELECT DISTINCT path FROM {DERIVED}").fetchall()
		return [path for (path,) in rows if path]


def _in_scope(start: date, end: date, paths: tuple[str, ...]) -> tuple[str, list]:
	"""Rows inside the inclusive date range and on one of `paths`."""
	if not paths:
		return "false", []
	marks = ", ".join(["?"] * len(paths))
	clause = (
		f"creation >= CAST(? AS DATE) AND creation < CAST(? AS DATE) + INTERVAL 1 DAY"
		f" AND path IN ({marks})"
	)
	return clause, [start, end, *paths]


def totals(start: date, end: date, paths: tuple[str, ...]) -> tuple[int, int]:
	where, params = _in_scope(start, end, paths)
	with reader() as db:
		views, new = db.execute(
			f"SELECT COUNT(*), COALESCE(SUM(is_new_visitor), 0) FROM {DERIVED} WHERE {where}", params
		).fetchone()
	return int(views or 0), int(new or 0)


def series(start: date, end: date, paths: tuple[str, ...], interval: str) -> dict[date, tuple[int, int]]:
	"""Views and new visitors per bucket start. DuckDB truncates to Monday, as ISO weeks do."""
	where, params = _in_scope(start, end, paths)
	with reader() as db:
		rows = db.execute(
			f"""
			SELECT CAST(date_trunc('{INTERVALS[interval]}', creation) AS DATE) AS bucket,
				COUNT(*), COALESCE(SUM(is_new_visitor), 0)
			FROM {DERIVED}
			WHERE {where}
			GROUP BY bucket
			""",
			params,
		).fetchall()
	return {bucket: (int(views), int(new)) for bucket, views, new in rows}


def top_paths(start: date, end: date, paths: tuple[str, ...], limit: int) -> list[tuple[str, int]]:
	where, params = _in_scope(start, end, paths)
	with reader() as db:
		rows = db.execute(
			f"""
			SELECT path, COUNT(*) AS views FROM {DERIVED} WHERE {where}
			GROUP BY path ORDER BY views DESC, path LIMIT {int(limit)}
			""",
			params,
		).fetchall()
	return [(path, int(views)) for path, views in rows]


def top_referrers(
	start: date, end: date, paths: tuple[str, ...], own_host: str, limit: int
) -> list[tuple[str, int]]:
	where, params = _in_scope(start, end, paths)
	with reader() as db:
		rows = db.execute(
			f"""
			SELECT referrer_host, COUNT(*) AS views FROM {DERIVED}
			WHERE ({where}) AND referrer_host <> ?
			GROUP BY referrer_host ORDER BY views DESC, referrer_host LIMIT {int(limit)}
			""",
			[*params, own_host],
		).fetchall()
	return [(host, int(views)) for host, views in rows]


def views_by_path(start: date, end: date) -> dict[str, tuple[int, int]]:
	"""Every path's views and new visitors in the range, for the wiki-wide overview."""
	with reader() as db:
		rows = db.execute(
			f"""
			SELECT path, COUNT(*), COALESCE(SUM(is_new_visitor), 0)
			FROM {DERIVED}
			WHERE creation >= CAST(? AS DATE) AND creation < CAST(? AS DATE) + INTERVAL 1 DAY
			GROUP BY path
			""",
			[start, end],
		).fetchall()
	return {path: (int(views), int(new)) for path, views, new in rows if path}


def views_by_referrer(start: date, end: date, paths: tuple[str, ...], own_host: str) -> dict[str, int]:
	"""Every referrer host's views in the range, for the wiki-wide overview."""
	where, params = _in_scope(start, end, paths)
	with reader() as db:
		rows = db.execute(
			f"""
			SELECT referrer_host, COUNT(*) FROM {DERIVED}
			WHERE ({where}) AND referrer_host <> ?
			GROUP BY referrer_host
			""",
			[*params, own_host],
		).fetchall()
	return {host: int(views) for host, views in rows}
