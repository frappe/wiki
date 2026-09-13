# Page View Analytics

Date: 2026-09-13
Status: **Phase 2 of 5 done** (2026-09-13). See [Progress](#progress).
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

### API

New module `wiki/api/analytics.py`:

```python
@frappe.whitelist()
def get_analytics(from_date: str, to_date: str, interval: str = "daily", space: str | None = None, document: str | None = None) -> dict: ...
```

One endpoint with optional `space` or `document` instead of three near copies. Returns `{total_views, unique_views, series, top_pages, top_referrers}` (a page scope skips `top_pages`).

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
4. **Benchmark.** Seed 1M and 5M rows, time the wiki-wide 180-day query. Record results here. Decide rollup yes or no.
5. **Dashboard.** Composable, chart, presets, drill down, top lists, tracking-off notice, wiki-wide Overview for managers, page level link. Playwright e2e for the dashboard flow.

## Decisions

Taken 2026-09-13.

1. Unique visitors use `COUNT(DISTINCT visitor_id)` per scope, not Frappe's site-wide `is_unique`.
2. Logged-in editors' own visits count, as in builder. `Web Page View` does not store the user, so filtering them is out of scope.
3. Space and page analytics are visible to space writers (`can_write_space`), not readers.

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
