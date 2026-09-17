# Copyright (c) 2026, Frappe and Contributors
# See license.txt

"""
Timing for the DuckDB mirror and wiki.api.analytics.get_analytics against a large
Web Page View table.

Not part of the test suite. It inserts rows into the site it runs on and deletes
them afterwards, so run it on a development site. Seeded rows and MariaDB's sort
files need free space on the database disk: about 300MB per million rows.

    bench --site <site> execute wiki.benchmarks.page_view_analytics.run --kwargs "{'rows': 1_000_000}"
"""

import os
import time
from statistics import median, quantiles

import frappe
from frappe.utils import add_days, get_url, nowdate

from wiki import analytics_store as store
from wiki.api import analytics

NAME_PREFIX = "bench-pv-"
DAYS = 180
BATCH = 250_000
RUNS = 7
# A scenario stops repeating once it has used this much time, so a slow query still reports.
BUDGET_SECONDS = 60
TIMED_HELPERS = ("_series", "_top_pages", "_top_referrers")


def run(rows: int = 1_000_000, keep: bool = False, reuse: bool = False) -> None:
	"""`reuse` times the rows a previous `keep` run left behind, skipping the slow seed and mirror."""
	frappe.set_user("Administrator")
	if not reuse:
		delete_rows()
	try:
		if not reuse:
			seconds = seed(rows)
			print(f"Seeded {rows:,} rows in {seconds:.0f}s over {DAYS} days", flush=True)
			started = time.perf_counter()
			mirrored = store.rebuild()
			print(f"Mirrored {mirrored:,} rows in {time.perf_counter() - started:.0f}s", flush=True)
		print(
			f"Spaces: {frappe.db.count('Wiki Space'):,}, pages: {frappe.db.count('Wiki Document'):,}, "
			f"mirror size: {os.path.getsize(store.database_path()) / 1024**2:.0f}MB",
			flush=True,
		)
		print_table(scenarios())
	finally:
		if not keep:
			delete_rows()


def seed(rows: int) -> float:
	"""Insert deterministic rows, skewed so a few pages and hosts get most traffic."""
	started = time.perf_counter()
	frappe.db.sql("DROP TEMPORARY TABLE IF EXISTS bench_paths")
	frappe.db.sql(
		# `Web Page View.path` is varchar(140), and a deep enough page route outgrows it.
		# Those routes are dropped rather than truncated, so the seeded paths stay real.
		"""CREATE TEMPORARY TABLE bench_paths (idx INT PRIMARY KEY, path VARCHAR(140))
		SELECT ROW_NUMBER() OVER (ORDER BY route) - 1 AS idx, route AS path
		FROM (SELECT route FROM `tabWiki Document` WHERE CHAR_LENGTH(route) BETWEEN 1 AND 140
			UNION SELECT route FROM `tabWiki Space` WHERE CHAR_LENGTH(route) BETWEEN 1 AND 140) routes"""
	)
	paths = frappe.db.sql("SELECT COUNT(*) FROM bench_paths")[0][0]
	own_url = get_url()

	for offset in range(0, rows, BATCH):
		size = min(BATCH, rows - offset)
		# CRC32 of the sequence number stands in for RAND() so every run seeds the same data.
		frappe.db.sql(
			f"""INSERT INTO `tabWeb Page View` (name, creation, modified, owner, modified_by, path, referrer, visitor_id)
			SELECT
				CONCAT(%(prefix)s, s.seq),
				TIMESTAMP(%(today)s) - INTERVAL (CRC32(CONCAT('t', s.seq)) %% (%(days)s * 86400)) SECOND,
				NOW(), 'Guest', 'Guest', p.path,
				CASE
					WHEN CRC32(CONCAT('r', s.seq)) %% 100 < 55 THEN CONCAT(%(own_url)s, '/', p.path)
					WHEN CRC32(CONCAT('r', s.seq)) %% 100 < 80 THEN NULL
					ELSE CONCAT('https://ref', CRC32(CONCAT('h', s.seq)) %% 50, '.example.com/some/page')
				END,
				CONCAT('visitor-', CRC32(CONCAT('v', s.seq)) %% %(visitors)s)
			FROM seq_{offset + 1}_to_{offset + size} s
			JOIN bench_paths p
				ON p.idx = FLOOR(POW((CRC32(CONCAT('p', s.seq)) %% 1000000) / 1000000, 3) * %(paths)s)""",
			{
				"prefix": NAME_PREFIX,
				"today": add_days(nowdate(), 1),
				"days": DAYS,
				"own_url": own_url,
				"visitors": max(rows // 4, 1),
				"paths": paths,
			},
		)
		frappe.db.commit()  # nosemgrep: a benchmark seeds millions of rows, one commit per batch
	frappe.db.sql("ANALYZE TABLE `tabWeb Page View`")
	return time.perf_counter() - started


def scenarios() -> list[tuple[str, dict]]:
	today = nowdate()
	busiest = frappe.db.sql(
		"""SELECT path FROM `tabWeb Page View` WHERE name LIKE %s AND path LIKE %s
		GROUP BY path ORDER BY COUNT(*) DESC LIMIT 1""",
		(f"{NAME_PREFIX}%", "%/%"),
	)[0][0]
	space = frappe.db.get_value("Wiki Space", {"route": busiest.split("/")[0]}, "name")
	document = frappe.db.get_value("Wiki Document", {"route": busiest}, "name")

	def last(days, interval="daily", **scope):
		return {"from_date": add_days(today, -(days - 1)), "to_date": today, "interval": interval, **scope}

	return [
		("wiki-wide, 180 days, daily", last(180)),
		("wiki-wide, 180 days, weekly", last(180, "weekly")),
		("wiki-wide, 30 days, daily", last(30)),
		("wiki-wide, 180 days, monthly", last(180, "monthly")),
		("busiest space, 180 days, daily", last(180, space=space)),
		("busiest page, 180 days, daily", last(180, document=document)),
	]


def time_scenario(kwargs: dict) -> dict[str, list[float]]:
	timings = {"total": []}
	originals = {name: getattr(analytics, name) for name in TIMED_HELPERS}

	def timed(name):
		def wrapper(*args, **kw):
			started = time.perf_counter()
			try:
				return originals[name](*args, **kw)
			finally:
				timings.setdefault(name, []).append(time.perf_counter() - started)

		return wrapper

	try:
		for name in TIMED_HELPERS:
			setattr(analytics, name, timed(name))
		analytics.get_analytics(**kwargs)  # warm up the page cache
		timings = {"total": []}
		for _ in range(RUNS):
			started = time.perf_counter()
			analytics.get_analytics(**kwargs)
			timings["total"].append(time.perf_counter() - started)
			if sum(timings["total"]) > BUDGET_SECONDS:
				break
	finally:
		for name, original in originals.items():
			setattr(analytics, name, original)
	return timings


def print_table(cases: list[tuple[str, dict]]) -> None:
	columns = ["total", *TIMED_HELPERS]
	print(f"\n{'scenario':<34}" + "".join(f"{c + ' p50/p95 ms':>30}" for c in columns), flush=True)
	for label, kwargs in cases:
		timings = time_scenario(kwargs)
		cells = "".join(f"{format_ms(timings.get(c, [])):>30}" for c in columns)
		print(f"{label:<34}{cells}", flush=True)


def format_ms(values: list[float]) -> str:
	if not values:
		return "-"
	p95 = quantiles(values, n=20, method="inclusive")[-1] if len(values) > 1 else values[0]
	return f"{median(values) * 1000:.0f} / {p95 * 1000:.0f}"


def seeded_days() -> list:
	return [add_days(nowdate(), -offset) for offset in range(DAYS, -1, -1)]


def delete_rows() -> None:
	frappe.db.sql("DELETE FROM `tabWeb Page View` WHERE name LIKE %s", f"{NAME_PREFIX}%")
	frappe.db.commit()  # nosemgrep: cleanup must persist even when the run fails
	# Rebuilding leaves the mirror holding only the site's real views.
	store.rebuild()
