# Page View Analytics

Date: 2026-09-13
Status: **Phase 4 of 5 done** (2026-09-13). See [Progress](#progress).
Reference: [frappe/builder](https://github.com/frappe/builder) at `94fd412` (2026-09-10).

## Goal

Show wiki authors and managers how their published pages are read:

- Total page views and unique visitors over a date range, as a chart.
- Top pages and top referrers.
- The same numbers scoped to one space and to one page.

The `Overview` route already waits for this. `frontend/src/pages/Overview.vue:1` and `frontend/src/components/LibrarySidebar.vue:231` both say wiki-wide analytics belong there later.

## How Frappe Builder Does It

Builder does not invent its own tracking. It rides on Frappe's built-in `Web Page View` log and adds a query layer and a dashboard on top.

### 1. Capture (browser to server)

- **Toggle:** `Website Settings.enable_view_tracking`. Everything is off unless this is on.
- **Client script:** `builder/templates/generators/webpage_scripts.html`. On `DOMContentLoaded` it:
  - loads FingerprintJS (`/assets/builder/js/identify.js`; Frappe ships the same lib at `/assets/frappe/js/lib/fingerprintjs.js`) to get a `visitorId`,
  - reads browser name/version, time zone and `utm_*` query params,
  - POSTs to `frappe.website.doctype.web_page_view.web_page_view.make_view_log`.
- **Server endpoint** (Frappe core, `allow_guest=True`):
  - takes the page `path` from the `Referer` **header**, not from a parameter, and drops non-site links and `api/`, `app/`, `assets/`, `private/files/`,
  - sets `is_unique` when this `visitor_id` has never been seen **on the whole site** (it is a unique visitor flag, not unique per page),
  - writes with `deferred_insert()`. Rows sit in Redis until the scheduler runs `frappe.deferred_insert.save_to_db` (every 15 minutes).
- **Schema** (`Web Page View`): `path`, `referrer`, `browser`, `browser_version`, `is_unique`, `time_zone`, `user_agent`, `visitor_id`, `source`, `campaign`, `medium`, `content`, plus `creation`.
- **Index:** builder adds a composite index on `(creation, is_unique, path)` in `after_install` and a patch (`builder/utils.py:641`).
- **Retention:** `WebPageView.clear_old_logs(days=180)` through Log Settings.

Builder also has opt-in **click tracking** (`Builder Page Click` DocType, `builder.api.make_click_log`, elements marked with `data-track`) to compute click-through rate.

### 2. Query layer (`builder/builder_analytics.py`)

- Every 10 minutes a cron job copies new `Web Page View` rows into a **DuckDB file** in the site folder (`builder_analytics.duckdb`), keyed on `MAX(creation)`, 20k rows per page. First run snapshots the whole table through pandas.
- Dashboard reads open DuckDB `read_only=True` and retry on the cross-process file lock.
- Queries, all parameterized except the table name and interval format:
  - totals: `COUNT(*)`, `SUM(is_unique)`,
  - series: group by `strftime(fmt, creation)` for `hourly | daily | weekly | monthly`,
  - top pages: group by `path`, limit 20,
  - top referrers: extract the domain from `referrer` with a regex, empty means `direct`.
- Route filter is `exact` (`path = ?`) or `wildcard` (`path LIKE %route%`).
- Any error is logged and an empty payload is returned.
- New deps: `duckdb==1.4.3` (and pandas).

### 3. API (`builder/api.py:613`)

`get_page_analytics`, `get_overall_analytics`, `get_page_ctr`. All whitelisted and gated by `@has_page_read`.

### 4. Dashboard (Vue)

- `composables/useAnalytics.ts`: date presets (today, this week, last 7/30/90/180 days, this year, custom), auto interval from range, drill down on chart click (month to days, day to hours), range persisted in `localStorage`, debounced refetch.
- `AnalyticsOverview.vue`: big numbers plus frappe-ui `AxisChart` area series for total and unique views.
- `GlobalAnalytics.vue`: site-wide with top pages and referrers lists. `PageAnalytics.vue`: one page.
- `TrackingDisabledNotice.vue`: empty state with a button that sets `enable_view_tracking = 1`.

## What Is Different In Wiki

These are the facts that stop us from copying builder as-is.

1. **Wiki pages never load `website_script.js`.** `wiki/templates/wiki/layout.html` is a standalone template, so turning on view tracking today logs nothing for wiki pages. We must add the capture script ourselves.
2. **The reader navigates client-side.** `Alpine.store('navigation').navigateTo()` in `wiki/templates/wiki/includes/sidebar.html:145` swaps content and calls `history.pushState`. A `DOMContentLoaded` hook fires only for the first page of a visit. Every in-reader navigation after that would go uncounted.
3. **Prefetch on hover** calls `get_page_data`. Those are not views and must not be logged.
4. **Hierarchy is space, then page.** `path` alone must map back to a `Wiki Space` (by route prefix) and a `Wiki Document` (by exact `route`) to show titles and scope numbers.
5. **Routes are editable** (`specs/editable_page_route.md`). A renamed route splits a page's history into two paths. There is no redirect table.
6. **Permissions are per space** (`wiki/permissions.py`: `can_read_space`, `can_write_space`, `_is_manager`). Builder has one `has_page_read` check.
7. **Frontend stack matches.** Wiki is on `frappe-ui 1.0.0-beta.55`, which ships `AxisChart`, so the chart code ports directly.

## Proposed Design

### Capture

Reuse `Web Page View` and `make_view_log`. No new DocType.

One small script, `wiki/public/js/page-view.js`, included from `layout.html` only when `enable_view_tracking` is on and the page is not a preview or a 404:

```js
// Called once on load and again after every client-side navigation.
window.wikiLogView = async (referrer) => {
	if (navigator.doNotTrack == 1) return;
	const visitorId = await getVisitorId(); // FingerprintJS, memoized per tab
	const q = new URLSearchParams(location.search);
	fetch('/api/method/frappe.website.doctype.web_page_view.web_page_view.make_view_log', {
		method: 'POST',
		keepalive: true,
		headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.CSRF_TOKEN },
		body: JSON.stringify({
			referrer,
			user_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
			source: q.get('utm_source'),
			medium: q.get('utm_medium'),
			campaign: q.get('utm_campaign'),
			visitor_id: visitorId,
		}),
	});
};
```

- First load: `wikiLogView(document.referrer)`.
- In `navigateTo`, **after** `history.pushState` (and on `popstate`), call `wikiLogView(previousUrl)`. The call must come after `pushState` because `make_view_log` reads the path from the `Referer` header, which the browser fills from the current document URL.
- `prefetch` stays untouched, so hovers never count.
- `make_view_log` stamps `creation` at request time, before the row waits in Redis, so the 15 minute flush does not blur the time series.
- Browser name and version are left out. `user_agent` is already stored server side, and the dashboard does not show browsers in v1.

### Storage and queries

**Superseded on 2026-09-13 by the phase 4 benchmark:** queries read a rollup table, see [Rollup](#rollup-phase-4-decision). The comparison below is kept for the record.

**Recommendation: query MariaDB directly in v1. Do not add DuckDB yet.**

| | MariaDB on `tabWeb Page View` | DuckDB snapshot (builder) |
|---|---|---|
| Freshness | Deferred insert lag only (up to 15 min) | Deferred insert lag plus 10 min cron |
| New deps | None | `duckdb`, `pandas` (large wheels) |
| Moving parts | Index plus queries | Cron, file lock retries, schema drift rebuild, a file per site that backups skip |
| Aggregate speed at 10M+ rows | Degrades on wide ranges | Stays fast |

Wiki traffic is docs traffic: far smaller than a marketing site. With a composite index on `(path, creation)` and a mandatory date range, grouped counts over a few million rows stay in the sub-second range. We prove this with a benchmark in `wiki/benchmarks/` against seeded rows (1M and 5M) before we ship. If p95 for a 180-day, wiki-wide query goes over 1s, the upgrade path is a daily rollup table (`Wiki Page View Daily`: date, path, views, unique_views) filled by a nightly job, and only after that DuckDB.

Queries live in `wiki/analytics.py` and use `frappe.qb`:

- `get_summary(scope, from_date, to_date)`: `COUNT(*)`, `SUM(is_unique)`.
- `get_series(scope, from_date, to_date, interval)`: group by `DATE_FORMAT(creation, fmt)`, with `fmt` picked from a fixed map (never user input).
- `get_top_pages(scope, from_date, to_date)`: group by `path`, left join `tabWiki Document` on `route` for the title, limit 20.
- `get_top_referrers(scope, from_date, to_date)`: group by referrer host. Parse the host in Python on the grouped rows, since MariaDB has no clean URL function.

`scope` is one of:

- wiki-wide: `path` in the routes of spaces the user can manage,
- space: `path = space.route OR path LIKE 'space.route/%'` (a prefix match, not builder's `%route%`, which also matches unrelated paths),
- page: `path = document.route`.

Date range is required and capped (for example 400 days) so no request scans the whole table.

### Rollup (phase 4 decision)

Every 15 minutes a scheduled job rolls up today and yesterday from `Web Page View` into `Wiki Page View Daily`:

| Field | Meaning |
|---|---|
| `date` | Day of the views |
| `path` | Page path, as logged |
| `referrer_host` | Host of the referrer, empty for direct |
| `views` | Row count |
| `new_visitors` | Views that were a visitor's first logged view |

- A view is a visitor's first when no `Web Page View` row with the same `visitor_id` is older. The job checks this with an index probe on `(visitor_id, creation)`, one day of rows at a time.
- Frappe's `is_unique` is not used. `make_view_log` computes it by looking for the `visitor_id` in the database, but rows wait in Redis for up to 15 minutes first, so every page a new visitor opens before the flush is marked unique.
- Re-rolling yesterday on each run picks up rows that were still in Redis when the day ended. Each run deletes a day's rollup rows and inserts them again, so it can repeat safely.
- A migration patch fills the rollup from every day already in the log.
- All sums are additive, so any range, scope and interval is a `SUM` over rollup rows. No request reads `Web Page View`.
- One covering index, `(path, date, referrer_host, views, new_visitors)`, serves every analytics query without reading table rows. `date` has its own index for the job's per-day delete.
- A scope's paths are found once per request: `DISTINCT path` over the rollup (a loose index scan), kept when a space route is the path or a `/`-bounded prefix of it, then passed to every query as `path IN (...)`. This replaced one `=`/`LIKE` pair per space, which cost 570ms at 20k rows with 288 spaces.
- The rollup grows with pages × days × referrer hosts, not with views, so its cost levels off as traffic grows.
- `hourly` is dropped: the rollup has no hours. Add an hourly rollup if a dashboard needs it.
- The rollup outlives `Web Page View` retention, and a visitor whose rows were all cleared counts as new again.

### API

New module `wiki/api/analytics.py`:

```python
@frappe.whitelist()
def get_analytics(from_date: str, to_date: str, interval: str = "daily", space: str | None = None, document: str | None = None) -> dict: ...
```

One endpoint with optional `space` or `document` instead of three near copies. Returns `{total_views, new_visitors, series, top_pages, top_referrers}` (a page scope skips `top_pages`).

Permissions:

- wiki-wide: `System Manager` or `Wiki Manager`,
- space or page: `can_write_space(space)`. Readers should not see traffic numbers.
- Call `can_write_space` directly, not `space.check_permission("write")`. The DocType-level check denies a `Wiki User` who holds a space's Write role, so it would lock out the people this is for.

`is_unique` note: Frappe sets it per site, not per page. So "unique visitors" in a space or page scope means "first-ever visits to the site that landed here". For a true per-scope count, use `COUNT(DISTINCT visitor_id)` instead of `SUM(is_unique)`. **Decision needed**, see Open Questions. Recommendation: `COUNT(DISTINCT visitor_id)`, since it is what a reader of the label expects.

### Frontend

- `frontend/src/composables/useAnalytics.js`: a trimmed port of builder's composable (presets, auto interval, drill down, debounced refetch). Drop CTR and route filter types.
- `frontend/src/components/Analytics/AnalyticsOverview.vue`: numbers plus `AxisChart`.
- `frontend/src/components/Analytics/TopList.vue`: shared list for top pages and top referrers.
- `frontend/src/components/Analytics/TrackingDisabledNotice.vue`: shown to managers when `enable_view_tracking` is off, with a button that turns it on.
- Placement:
  - wiki-wide on `Overview.vue` (managers only; everyone else keeps today's space directory),
  - space in a new **Analytics** tab in `SpaceSettings.vue`,
  - page as a small "Views (30 days)" line in `PageSettingsPanel.vue` that opens the space tab filtered to that page.

### Out of scope for v1

- **Click tracking and CTR.** Builder needs it for landing page CTAs. Docs pages have no CTAs. Add when someone asks.
- **DuckDB.** Add only if the benchmark fails.
- **Merging history across route renames.** Needs a redirect table first.
- **Search analytics** and **feedback rating next to views** (`Wiki Feedback` already stores ratings per document). Good next steps, separate spec.

## Privacy

- Off by default. It only runs when a manager turns on `enable_view_tracking`.
- Respect `navigator.doNotTrack`.
- FingerprintJS makes a device id. That is personal data under GDPR. Document it in the admin UI next to the toggle.
- Retention follows Log Settings for `Web Page View` (180 days default).

## Plan (tracer bullets)

Each phase goes end to end and gets a commit.

1. **Bullet: one number on screen.** Capture script on first load only, index patch, `get_analytics` returning `total_views` for a space, a bare number in the space Analytics tab. Verify: open a page as Guest, flush with `bench --site wiki.localhost execute frappe.deferred_insert.save_to_db`, see the count go up.
2. **Client-side navigation.** Log in `navigateTo` and `popstate`, never in `prefetch`. Playwright e2e: load a page, click two sidebar links, hover a third, flush, assert 3 rows with the right paths.
3. **Full query set.** Series, unique visitors, top pages with titles, top referrers, permission checks. Unit tests in `wiki/tests/test_analytics.py` (seed `Web Page View` rows directly, cover scope prefix matching, date bounds, permission denial).
4. **Benchmark.** Seed 1M and 5M rows, time the wiki-wide 180-day query. Record results here. Decide rollup yes or no. Outcome: yes, then build it: `Wiki Page View Daily`, the 15 minute job, a backfill patch, `get_analytics` reading the rollup, and the benchmark re-run against it.
5. **Dashboard.** Composable, chart, presets, drill down, top lists, tracking-off notice, wiki-wide Overview for managers, page level link. Playwright e2e for the dashboard flow.

## Decisions

Taken 2026-09-13.

1. ~~Unique visitors use `COUNT(DISTINCT visitor_id)` per scope, not Frappe's site-wide `is_unique`.~~ Replaced by decision 4.
2. Logged-in editors' own visits count, as in builder. `Web Page View` does not store the user, so filtering them is out of scope.
3. Space and page analytics are visible to space writers (`can_write_space`), not readers.
4. (2026-09-13, after the phase 4 benchmark) Numbers come from a rollup table. Distinct visitors cannot be summed across days or pages, so the metric is **new visitors**: views that were a visitor's first logged view on the site. It is computed by the rollup job, not taken from Frappe's `is_unique`.
5. (2026-09-13) The `hourly` interval is dropped with the move to a daily rollup.

## Progress

### Phase 1: one number on screen (2026-09-13)

Built:

- `wiki/templates/wiki/includes/page_view.html`: capture script, included by `layout.html` when `enable_view_tracking` is on. Defines `window.wikiLogView(referrer)` and calls it once on load. Honours Do Not Track.
- `WikiDocumentRenderer.render` passes `enable_view_tracking` into the template context.
- `wiki/patches/add_web_page_view_path_index.py`: `(path, creation)` index, also run from `after_install`.
- `wiki/api/analytics.py`: `get_analytics(space, from_date, to_date)` returns `{total_views}`. Prefix match escapes LIKE wildcards, since space routes may contain `_`. Range must be ordered and at most 400 days.
- `SpaceSettings/AnalyticsPanel.vue`: new Analytics tab showing views for the last 30 days.

Verified:

- Unit tests `wiki/api/test_analytics.py` (5 cases): prefix scoping including a sibling route and a `_` wildcard lookalike, inclusive date bounds, writer allowed, reader denied, bad ranges rejected. Temporarily dropping the LIKE escaping and the permission check fails 2 of them.
- Browser, with tracking on: the page on the pre-change server makes no `make_view_log` call. The same page on this branch makes one (200), and after `frappe.deferred_insert.save_to_db` the row has the right path, time zone and visitor id.
- The Analytics tab shows the logged count for Administrator, in light and dark themes.


### Phase 2: client-side navigation (2026-09-13)

Built:

- `Alpine.store('navigation')` in `includes/sidebar.html`: both `navigateTo` branches (prefetch cache hit and fetch) now go through one `showPage(route, data, pushState)`, which updates the content, pushes the URL and then calls `window.wikiLogView(previousUrl)`. Back and forward reach it through the existing `popstate` handler. `prefetch` is untouched, so hovers never log.
- The referrer sent for an in-reader navigation is the previous page's URL.

Verified:

- `e2e/tests/page-view-tracking.spec.ts`: load Alpha, click Beta, click Gamma, hover Delta (waits for its prefetch), go back. Asserts exactly 4 view logs with paths Alpha, Beta, Gamma, Beta (from the Referer header) and the previous page as referrer. It fails at the second log on the phase 1 code, passes after, and passed 3 repeated runs. It turns tracking on for the suite and restores the previous value.
- After flushing the queue, the stored `Web Page View` rows match those paths and referrers.
- Reader specs that do not need the editor build (among them `sidebar-reveal`, which covers prev/next navigation) pass locally. Specs that drive the editor app could not run locally from this worktree, before or after the change, since the dev bench serves another branch's editor build. CI covers them.

### Phase 3: full query set (2026-09-13)

Built:

- `get_analytics(from_date, to_date, interval="daily", space=None, document=None)` in `wiki/api/analytics.py` now returns `total_views`, `unique_views`, `series`, `top_referrers` and, outside a page scope, `top_pages`. The phase 1 space tab still reads `total_views` unchanged.
- Scopes: no `space` or `document` means wiki-wide, a union of every space's route prefix, so non-wiki web pages never count. `space` is a prefix match. `document` is an exact match on the page's route. Passing both is rejected.
- Permissions: wiki-wide needs `_is_manager` (System Manager, Wiki Manager). Space and page need `can_write_space` on the space (for a page, found through `get_wiki_space()`).
- `unique_views` is `COUNT(DISTINCT visitor_id)` in the scope and in each series bucket, per decision 1.
- `series`: buckets from `DATE_FORMAT` with a fixed format per `hourly | daily | weekly | monthly`. Weeks start on Monday (ISO week). Empty buckets are filled with zeros so a chart does not draw a line across a gap. Hourly is capped at 31 days to bound the bucket count.
- `top_pages`: top 20 paths by views, titled from `Wiki Document.route`, with a space's own route titled by its space name. A path with no matching page (renamed or deleted) has `title: null`.
- `top_referrers`: top 20 referrer hosts. An empty referrer is `referrer: null` (direct). Referrers on this site's own host are skipped, since phase 2 sends the previous page as referrer and in-reader navigation would otherwise top the list.

Verified:

- `wiki/api/test_analytics.py`, 14 cases, passed 3 repeated runs. New cases cover distinct visitors, daily gap filling, hourly, weekly and monthly buckets, top page titles and ranking, referrer host grouping with own-site skip, exact page scope, page scope denial for a reader, wiki-wide manager gate and non-wiki path exclusion, and space plus document rejection.
- Mutation check: removing the own-host skip, `DISTINCT`, gap filling, the manager check, the page permission check or the exact page match each fails its test.
- Not verified over HTTP: the dev bench serves another branch, so tests ran with `PYTHONPATH` pointing at this worktree. Phase 5 adds the dashboard e2e.

### Phase 4: benchmark (2026-09-13)

Built:

- `wiki/benchmarks/page_view_analytics.py`: seeds `Web Page View` rows in SQL from MariaDB's `seq_1_to_N` table (deterministic: `CRC32` instead of `RAND()`, pages and referrer hosts skewed, one visitor per four views, 55% own-site referrers, 25% direct), times `get_analytics` per scenario with a split for series, top pages and referrers, then deletes the rows. Run with `bench --site <site> execute wiki.benchmarks.page_view_analytics.run --kwargs "{'rows': 1_000_000}"`.

Setup: local dev site, MariaDB 10.11, 16 cores, `innodb_buffer_pool_size` 128MB (the default, far below a production server), `Web Page View` is `ROW_FORMAT=COMPRESSED`, 288 spaces and 1,928 pages. Rows spread over 180 days.

Results:

| Rows | Query | Time |
|---|---|---|
| 20k | `get_analytics`, wiki-wide, 180 days, daily (p50 / p95 of 7) | 659 / 667 ms |
| 20k | same, 30 days | 175 / 177 ms |
| 20k | busiest space, 180 days | 21 / 23 ms |
| 20k | busiest page, 180 days | 8 / 10 ms |
| 1M | `get_analytics`, wiki-wide, 180 days | did not finish: the series query alone ran over 50s, run stopped |
| 1M | `COUNT(*)` over 180 days | 0.46 s |
| 1M | `COUNT(*), COUNT(DISTINCT visitor_id)` over 180 days, optimizer's plan (range on `creation`) | 83.5 s |
| 1M | same, forced full table scan | 3.5 s |
| 1M | same, with a covering index `(creation, path, visitor_id)` | 1.5 s |
| 1M | `DISTINCT path` over 180 days | 1.1 s |

What the numbers say:

1. **Distinct visitors are the cost, not the view counts.** Counting views over 1M rows takes under half a second. Adding `COUNT(DISTINCT visitor_id)` takes 83s, because the optimizer walks the `creation` index for a range that covers the whole table and then does a random, decompressing primary key lookup per row. Even the best plan found (a covering index) takes 1.5s for one number, and the series repeats that work per bucket.
2. **The wiki-wide scope is slow even when small.** At 20k rows the 180-day request already takes 659 ms: 288 spaces become 576 `=` and `LIKE` conditions, checked on every row by each of the four queries.
3. **The 1s gate fails at 1M rows.** 5M was not run: MariaDB's data and temp directories are on a root disk with 1.1GB free, and grouped `COUNT(DISTINCT)` failed with `Errcode: 28 "No space left on device"` while spilling a sort file. The table was truncated afterwards (it held only benchmark rows).
4. **Log retention does not save us.** With 180 days of retention, a 180-day range always covers the whole table, so the wiki-wide query is a full scan by design.
5. **The planned rollup cannot hold distinct visitors.** A `Wiki Page View Daily` row with `unique_views` per path per day cannot be summed into a multi-day or multi-page count: the same visitor would be counted once per day and per page.

Decision (2026-09-13): add the rollup, with new visitors instead of distinct visitors. See decisions 4 and 5 and [Rollup](#rollup-phase-4-decision).

#### Rollup build (2026-09-13)

Built:

- `Wiki Page View Daily` DocType, read-only, readable by System Manager and Wiki Manager.
- `roll_up_day`, `roll_up_days`, `roll_up_recent_days` (cron every 15 minutes in `hooks.py`) and `roll_up_all_logged_days` in `wiki_page_view_daily.py`.
- `wiki.patches.backfill_page_view_rollup` (post model sync): adds the `(visitor_id, creation)` index on `Web Page View` and rolls up every logged day, committing per day. `after_install` adds the same index.
- `wiki.patches.add_web_page_view_path_index` from phase 1 is removed before release: nothing reads `Web Page View` by path any more.
- `get_analytics` reads the rollup and returns `new_visitors` in place of `unique_views`. `hourly` is rejected. Series dates are plain dates.
- The benchmark now also times the rollup, re-rolls the seeded days when it cleans up, and has `keep` and `reuse` flags so index experiments can skip the ten minute seed.

Verified:

- `test_wiki_page_view_daily.py` (3 cases): first view per visitor across days, same-second ties, missing and empty visitor ids, all rows flagged `is_unique` as Redis leaves them; referrer host grouping including ports, non-web schemes and non-URLs; re-rolling a day replaces it and a late row from the day before moves the visitor's first view.
- `test_analytics.py` (14 cases) updated for new visitors and date buckets. Both suites passed twice.
- Mutation check: counting every view as new, dropping the same-second tie-break, dropping the empty visitor check, skipping the delete before re-rolling, dropping the own-host filter, dropping the range end, and matching routes with a plain `startswith` each fail at least one test.
- The scheduled function runs with `bench execute`, and `frappe.get_hooks("scheduler_events")` lists it under `*/15 * * * *`.

Benchmark, same machine and 128MB buffer pool, 1M views seeded over 180 days:

- Seed: 351s. Rollup of 181 days: 218s (about 1.2s per day at 5,500 views a day, so a 15 minute run over two days costs about 2.5s). 539,194 rollup rows, 280,109 of them distinct path-days.

| Scenario (p50 / p95 ms) | Raw log (phase 3) | Rollup, `(date, path)` index | Rollup, covering index and loose path scan |
|---|---|---|---|
| wiki-wide, 180 days, daily | over 50s, stopped | 9,020 / 9,198 | 1,699 / 1,815 |
| wiki-wide, 180 days, weekly | not run | 9,014 / 9,285 | 1,693 / 1,735 |
| wiki-wide, 180 days, monthly | not run | 8,789 / 9,034 | 1,660 / 1,718 |
| wiki-wide, 30 days, daily | not run | 2,720 / 2,821 | 421 / 434 |
| busiest space, 180 days | not run | 5,545 / 5,702 | 71 / 73 |
| busiest page, 180 days | not run | 2,010 / 2,309 | 16 / 16 |

- At 20k views the final design takes 166ms wiki-wide over 180 days, 38ms for a space and 14ms for a page.
- Wiki-wide over 180 days still misses the 1s goal on this machine. Its time splits into top referrers 614ms, series 527ms, top pages 324ms, and totals plus path lookup about 230ms: each groups every rollup row in range. The 128MB buffer pool is smaller than the 236MB rollup table, so this is partly disk reads. A production-sized pool could not be tried: the site's database user cannot resize it.
- 5M was not run: the database disk has 1.4GB free. Since the rollup grows with pages × days × hosts rather than views, 5M views over the same pages should land close to the 1M numbers. That is a prediction, not a measurement.
- Seeded rows and the rollup were truncated afterwards. Both tables held only benchmark data.
