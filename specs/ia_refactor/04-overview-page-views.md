# Overview Page + Page View Analytics

Date: 2026-09-01, split and revised 2026-09-08
Status: **Planned — builds last** in the IA program. Phase 1 (tracking) should
merge early so data accumulates before the page that reads it exists.
Prototype: `wiki-proto` — `Overview.vue`.
Reference implementation: `apps/builder` — `builder/builder_analytics.py`,
`frontend/src/components/Settings/GlobalAnalytics.vue`.

Search analytics moved out of this spec on 2026-09-08 — see
[05-search-analytics.md](05-search-analytics.md). This spec owns the Overview
page shell, the view pipeline, and every section driven by views. Spec 05 adds
its own sections to the shell this one builds.

## Problem

The app lands on a placeholder that answers only "what spaces exist". Wiki
owners have no answer to what is being read, which spaces carry traffic, and
which pages have gone stale. The data is nearly free — wiki pages are website
routes and Frappe already has a `Web Page View` doctype — but nothing in wiki
writes to it today.

## Goal

`/` becomes the Overview: a KPI strip (views, visitors, each with a delta
against the previous window), a views-over-time `AreaChart` scoped wiki-wide or
per space, views-by-space, top pages, and a "needs attention" list. Range:
7/30/90 days.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | View storage | Frappe's `Web Page View` doctype, keyed by `path`. Reusing it buys the desk list view, the `Log Settings` retention hook, and a schema that already carries `referrer` / `browser` / `visitor_id` / UTM fields. |
| 2 | **The reader does not load Frappe's tracker** | `make_view_log` is driven client-side by `frappe/www/website_script.js`, which only reaches templates extending `templates/web.html`. `wiki/templates/wiki/layout.html:1` is a standalone `<!DOCTYPE html>` with Alpine and wiki bundles only — no `frappe.ready`, no `frappe.call`. **Wiki must ship its own tracking script.** The former decision 1 ("the Jinja page load logs") was wrong. |
| 3 | Wiki owns the write endpoint | New `wiki.api.analytics.log_view(route, visitor_id, referrer, tz, utm…)`, `allow_guest`, which resolves `route` to a published `Wiki Document`, drops non-wiki paths, and `deferred_insert`s a `Web Page View` row. We do **not** call `make_view_log`: it infers `path` from the `Referer` header, which is implicit, untestable, and wrong-by-one-navigation for SPA route swaps. |
| 4 | **Two view chokepoints, and the renderer is not one of them** | (a) Hard load — a small script in `layout.html`, after render. (b) SPA route swap — `navigateTo()` in `wiki/templates/wiki/includes/sidebar.html:145`. Logging server-side in `WikiDocumentRenderer.render()` misses every SPA navigation; logging in `get_page_data` is worse in both directions — `prefetch()` (`sidebar.html:124`) hits it on `@mouseenter`, so hovers count as views, while a navigation served from `prefetchCache` never calls it at all. The log fires from `updateContent()`, the one function on every real view regardless of cache path. |
| 5 | Tracking gate | New `Wiki Settings` check `enable_view_tracking`, default on, **independent of Website Settings**. The reader does not use Frappe's tracking pipeline, so coupling to a setting that governs it would only confuse. Per the frontend/backend sync convention, the field must also be surfaced in the frontend settings panel. |
| 6 | Bot filtering | The reader is public and crawled. Drop views whose user agent matches a bot pattern before insert, and honour `navigator.doNotTrack` client-side (Frappe's own tracker does). Without this the KPI strip measures Googlebot. |
| 7 | Visitor identity | `visitor_id` from `fingerprintjs`, loadable directly as a static asset (`/assets/frappe/js/lib/fingerprintjs.js`) without the frappe bundle. **Leave `is_unique` unset**: `make_view_log` computes it with `frappe.db.exists("Web Page View", {"visitor_id": …})` on *every* insert, an unindexed lookup against a table that only grows. Distinct visitors are a `COUNT(DISTINCT visitor_id)` at query time instead. |
| 8 | Markdown / agent traffic | `Accept: text/markdown` responses and the `llms.txt` endpoints are **not** counted — no browser, no script, and mixing agent reads into "views" makes the human number meaningless. A separate "agent reads" metric is a possible follow-up, not scope. |
| 9 | Route → space mapping | Longest-prefix match of a view's `path` against `Wiki Space.route`, resolved at query time (spaces are few). A space rename re-buckets history — accepted. |
| 10 | **Aggregation engine — revised** | **Start on MariaDB**, not DuckDB. The 2026-09-01 approval of `duckdb` + `pandas` predates two facts: `deferred_insert` already batches writes, and `Log Settings` already caps table growth. A single-table `GROUP BY` over a bounded, indexed `Web Page View` does not need a columnar engine. Keep builder's *API shape* so the UI never learns the difference, and port `builder_analytics.py` only when a measured Overview query crosses ~500 ms on real data. This reverses part of decision 2 of the old spec — **flag for approval before phase 2**. |
| 11 | Deltas | Computed server-side against the equal-length previous window. Every delta is window vs window-before. An empty previous window yields no delta, not +100%. |
| 12 | API surface | Whitelisted and gated like builder's `@has_page_read`: `wiki.api.analytics.get_overview(range, space)` returning kpis + series + by-space + top-pages, and `get_needs_attention()`. |
| 13 | Needs attention | Computed server-side, no new storage: **Stale** (`modified` older than N months, default 6), **Unpublished but linked** (unpublished doc with inbound links from published pages), **Low rating** (from `Wiki Feedback.rating`, below threshold with a minimum sample). Broken-link detection is **out of scope** — it needs a crawler. |
| 14 | UI | Prototype `Overview.vue` near-verbatim: no cards — sections separated by space and ink ladder; KPI strip with divide-x rules; `AreaChart` from `frappe-ui/charts` (confirmed present at beta.55); `TabButtons` range switch in the `h-12` header; scope `Select` on the chart only (KPI strip stays wiki-wide); fixed-width `Progress` meters in views-by-space; row-links navigate into spaces/pages; "All clear" empty state for needs-attention. |
| 15 | The placeholder's other two jobs | `frontend/src/pages/Overview.vue` currently also owns the **empty-wiki state** and the **only space list on mobile**, where no sidebar exists. Analytics sections are added *beside* those, not instead of them. Mobile keeps the space list. |
| 16 | Access | Analytics sections require manager/editor permission. A non-manager on `/` sees today's placeholder unchanged. |
| 17 | Empty data | First run with no rows shows zeros plus a "No data yet" hint and, for a manager, a pointer to the tracking setting. The page must not look broken. |
| 18 | Retention | Not our code. Register `Web Page View` in `Log Settings`; its `clear_old_logs(days=180)` is already implemented upstream. This closes the old spec's retention open question. |

## Current state

- **No analytics code in wiki at all** — verified: zero references to
  `Web Page View`, `web_page_view`, or `make_view_log` anywhere in `wiki/` or
  `frontend/src/`.
- `frontend/src/pages/Overview.vue` exists as the spec 01 placeholder (173
  lines), route name `Overview`, already permission- and mobile-aware.
- `WikiDocumentRenderer` (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.py:648`)
  serves hard loads; `get_page_data` (same file, `:913`) serves SPA swaps and
  hover prefetches alike.
- `Wiki Feedback` exists with a `rating` field — feeds the low-rating signal.
- `AreaChart` confirmed in `frappe-ui@1.0.0-beta.55` under the `./charts`
  export.
- Spec 01 owns the `/` route and the Overview sidebar item; this spec fills the
  placeholder.

## Phases

1. **Tracking (merge early, independent of UI).** `Wiki Settings` gate,
   `log_view` endpoint with bot filter and route validation, `layout.html`
   snippet for hard loads, `updateContent()` call for SPA swaps, `Log Settings`
   registration. Unit tests on the write path.
2. **Aggregation.** `get_overview` on MariaDB with range/scope and deltas.
   Tests against fabricated rows.
3. **Overview UI tracer.** KPI strip + `AreaChart` from the real API, range
   switch, behind the manager gate, placeholder jobs preserved.
4. **Sections.** Views-by-space, top pages.
5. **Needs attention.** Stale and low-rating first; unpublished-but-linked once
   an inbound-link query exists.

## Regression tests

- Unit: previous-window delta math, including an empty previous window.
- Unit: longest-prefix space bucketing, including a space route that is a
  prefix of another.
- Unit: `log_view` rejects unpublished routes, non-wiki paths, and bot user
  agents; respects the settings gate.
- Unit: a hover prefetch logs nothing — the regression test for decision 4.
- e2e: Overview renders with zero data (empty states) and with seeded data.

## Landmines

- **Prefetch double-counting** (decision 4). The single easiest way to ship a
  wrong number here.
- **Reader has no frappe JS** (decision 2). Any snippet written against
  `frappe.call` or `frappe.ready` silently does nothing. Use plain `fetch` with
  the `window.CSRF_TOKEN` the reader already sets.
- **Public reader SPA DOM twins**: reader markup is duplicated between the
  Jinja templates and the `sidebar.html` nav-store JS. The tracking call has to
  live on the JS side of that twin, not only in the template.
- **`is_unique` cost** (decision 7) — an unindexed existence check per insert.
- Local dev site has a large document set; needs-attention queries must be
  indexed and bounded from day one.
- Fingerprinting is a privacy decision as much as a technical one. `doNotTrack`
  is honoured; consider whether `visitor_id` should be salted per site.

## Open questions

- Decision 10 reverses the approved DuckDB choice. **Needs sign-off.**
- Should an authenticated app-side page read count as a view, or is the
  Overview strictly about published-reader traffic? Current assumption:
  reader only.

## Progress log

- 2026-09-01 — Spec written from `wiki-proto` + builder analytics read.
- 2026-09-01 — Decisions locked: tabs removed, `/spaces` retired, duckdb+pandas
  approved, avatar auto-roll on create.
- 2026-09-08 — Split: search moved to spec 05. Verified against the code that
  the reader loads no frappe tracker (D2), that the renderer is the wrong hook
  and `get_page_data` is worse (D4), and that retention is already solved by
  `Log Settings` (D18). Recommended MariaDB-first (D10, needs sign-off).
