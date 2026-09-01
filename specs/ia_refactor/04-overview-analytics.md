# Overview Page + Page Analytics (Builder-style)

Date: 2026-09-01
Status: **Planned — builds last** in the IA program, but phase 1 (tracking)
should merge early so data accumulates.
Prototype: `wiki-proto` — `Overview.vue`, analytics stubs in `data.ts`.
Reference implementation: `apps/builder` — `builder/builder_analytics.py`,
`builder/api.py` (`get_page_analytics`, `get_overall_analytics`),
`frontend/src/components/Settings/{GlobalAnalytics,PageAnalytics}.vue`.

## Problem

The app lands on a space list that answers only "what spaces exist". Wiki
owners have no answer to: what is being read, what are readers searching for
and not finding, and which pages need work. All of that data is either free
(Frappe's `Web Page View` tracking) or cheap to log.

## Goal

`/` becomes the Overview: a KPI strip (views, visitors, searches, no-result
searches — each with delta vs the previous period), a views-over-time
AreaChart scoped wiki-wide or per space, views-by-space, top pages, top
searches (no-result rows flagged red), and a "needs attention" list. Range:
7/30/90 days. Analytics machinery built like Frappe Builder's.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | View source | Frappe's own `Web Page View` rows (`frappe.website.doctype.web_page_view.make_view_log`), keyed by `path`. Wiki pages are website routes, so published-reader traffic is already loggable — ensure tracking is enabled for wiki routes and that the SPA reader's client-side navigations also fire `make_view_log` (the Jinja page load logs; SPA route swaps must call it explicitly). |
| 2 | Aggregation engine | **Builder's pattern**: per-site DuckDB file (`wiki_analytics.duckdb`) fed by a scheduled ingestion job copying `Web Page View` (and search log) rows; read-only connections for dashboard queries with brief lock retries. Port `builder_analytics.py`'s `DuckDBConnection`, ingestion, interval formats, where-clause builders — trimmed to what the Overview needs. `duckdb` + `pandas` as new wiki dependencies **approved 2026-09-01**. |
| 3 | Route → space mapping | A view row's `path` maps to a space by longest-prefix match on `Wiki Space.route`. Resolved at query time (spaces are few); a space rename (update_routes) simply re-buckets history — accepted. |
| 4 | Search logging | New doctype `Wiki Search Log` (term, normalized term, result_count, space, user hash, creation) written by the existing search endpoint(s), reader and app alike. "No-result search" = result_count 0. This is the one metric an owner can act on directly (content gap), so it earns a doctype. |
| 5 | Needs attention | Computed server-side, no new storage: **Stale** (page `modified` older than N months, default 6), **Unpublished but linked** (unpublished doc with inbound links from published pages), **Low rating** (from existing `Wiki Feedback`, below threshold with a minimum sample). Broken-link detection is **out of scope** (needs a crawler). |
| 6 | API surface | Whitelisted, manager/space-read gated like builder's `@has_page_read`: `wiki.api.analytics.get_overview(range, space)` returning kpis + series + by-space + top-pages, `get_top_searches(range)`, `get_needs_attention()`. Deltas computed server-side against the equal-length previous window (prototype rule: every delta is window vs window-before). |
| 7 | UI | Prototype `Overview.vue` near-verbatim: no cards — sections separated by space and ink ladder; KPI strip with divide-x rules; `AreaChart` from `frappe-ui/charts`; `TabButtons` range switch in the h-12 header; scope `Select` on the chart only (KPI strip stays wiki-wide); fixed-width `Progress` meters in views-by-space; row-links navigate into spaces/pages; red badge only on no-result searches; "All clear" empty state for needs-attention. |
| 8 | Access | Overview is for wiki managers/editors. Non-managers landing on `/` see the placeholder from spec 01 (pick a space) — analytics sections require the permission. |
| 9 | Empty data | First run with no view rows: KPI strip shows zeros with "No data yet" hint + a pointer to enable tracking; page must not look broken. |

## Current state

- No view tracking, no search logging, no analytics code in wiki today
  (checked: no `Web Page View` / `view_log` references).
- `Wiki Feedback` doctype exists — feeds the low-rating signal.
- `frappe-ui/charts` AreaChart available (used in prototype).
- Spec 01 owns the `/` route + "Overview" sidebar item; this spec fills the
  placeholder.

## Phases

1. **Tracking (merge early, independent of UI).** Ensure `Web Page View`
   logging on published wiki routes incl. SPA navigations; add
   `Wiki Search Log` + write path from the search endpoint. Unit tests on the
   write paths.
2. **Aggregation.** Port builder's DuckDB module (connection, setup, scheduled
   ingestion of views + searches), `get_overview` API with range/scope +
   deltas. Test against fabricated rows.
3. **Overview UI tracer.** KPI strip + AreaChart from the real API, range
   switch. Ship behind manager gate; placeholder retires.
4. **Sections.** Views-by-space, top pages, top searches.
5. **Needs attention.** Stale + low-rating first; unpublished-but-linked once
   an inbound-link query exists.

## Regression tests

- Unit: previous-window delta math (incl. empty previous window ⇒ no delta),
  longest-prefix space bucketing, no-result search flagging.
- Unit: ingestion idempotence (re-run doesn't duplicate rows) — builder tracks
  a high-water mark; keep it.
- e2e: overview renders with zero data (empty states) and with seeded data.

## Landmines

- **DuckDB file lock**: one read-write connection is exclusive — dashboard
  reads must always pass `read_only=True` (builder's retry wrapper handles
  the ingestion window).
- New Python deps (`duckdb`, `pandas`) — check bench/site install story and
  wheel availability on the CI image before committing to phase 2; the
  fallback is plain MariaDB aggregation on `Web Page View` (slower, no new
  deps) with the same API shape, so the UI never has to know.
- `Web Page View` logging is site-config dependent; the Overview must degrade
  informatively, not silently zero.
- Search endpoints may be hit by guests at volume — `Wiki Search Log` writes
  must be cheap (insert-only, background where possible) and rate-safe.
- Local dev site has 1847 spaces / 11k docs — needs-attention queries must be
  indexed/bounded from day one.

## Open questions

- Retention: cap DuckDB/`Web Page View` history (builder keeps everything)?
  Suggest 180 days to match the prototype's series.
- Per-space overview (the prototype's chart scope hints at it) — same API
  scoped by space could later power a space-level dashboard tab; out of scope
  now.

## Progress log

- 2026-09-01 — Spec written from `wiki-proto` + builder analytics read.
- 2026-09-01 — Decisions locked: tabs removed, /spaces retired, duckdb+pandas approved, avatar auto-roll on create.
