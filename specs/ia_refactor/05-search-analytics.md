# Search Log + Search Analytics

Date: 2026-09-08
Status: **Planned.** Split out of the former `04-overview-analytics.md`.
Depends on [04-overview-page-views.md](04-overview-page-views.md) for the
Overview page shell, the range switch, and the delta convention.
Reference model: **Algolia search analytics** — see Decisions 2-4.

## Problem

An owner can see what readers read (spec 04) but not what they *looked for*.
The queries that return nothing are the only signal on this page that names a
missing page outright, and the queries that return results nobody clicks name a
page that exists but does not answer. Neither is recorded anywhere today.

## Goal

Overview gains: search KPIs (searches, no-results rate, click-through rate),
a top-searches table with no-result rows flagged, and an abandonment column.
Range switch shared with spec 04.

## The counting problem

Reader search is search-as-you-type. `wiki/templates/wiki/includes/search_modal.html:51`
binds `@input.debounce.200ms="search()"`, so typing `kubernetes` can hit
`wiki.frappe_wiki.doctype.wiki_document.search.search` ten times. Logging at
the endpoint, as the original spec said, would record `k`, `ku`, `kub`… as
separate searches — most with `result_count: 0`. Top-searches would fill with
prefixes and the no-results metric would measure typing speed.

Algolia solved exactly this and their model is the one adopted below: log every
request, **aggregate at read time**, and carry clicks on a separate event
stream joined by a query id.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Storage | New doctype **`Wiki Search Log`** in `wiki/frappe_wiki/doctype/` (the v3 tree, beside `wiki_document`): `term`, `normalized_term`, `result_count`, `space`, `session_id`, `visitor_hash`, `query_id`, `creation`. Insert-only, written with `deferred_insert` so a guest burst never blocks a search. |
| 2 | **Log every request; aggregate on read** | Every keystroke query is written. Collapsing happens in the aggregation pass, not at the write. This is Algolia's split between a billed *search request* and a reported *search*, and it keeps the hot path a single insert. |
| 3 | **Aggregation window: 30 seconds, final query wins** | Requests sharing a `session_id` with less than 30 s between them collapse to one search. The surviving row is the **last** in the chain, not the longest — a reader who types `kubernetes` and backspaces to `kube` settled on `kube`, and longest-wins would record the query they abandoned. Algolia keys on IP + timezone + timeframe; a client-generated `session_id` is the same idea with less guessing. |
| 4 | **Clicks are a separate event, joined by `query_id`** | The search response gains a `query_id` (it returns no id at all today). Result selection in the modal posts `wiki.api.analytics.log_search_click(query_id, document, position)`. Without this join there is no CTR and no abandonment — the metric that catches a query returning results that answer nobody. |
| 5 | **Metrics are rates over aggregated searches, not raw counts** | No-results rate = % of searches returning zero. CTR = % of searches with at least one click (multiple clicks count once). Abandonment = % with no click. Click position = mean rank of clicked results, lower is better. A raw "no-result searches" count over unaggregated rows counts backspaces. |
| 6 | Write sites | Today there is exactly one: the reader modal's endpoint, `wiki/frappe_wiki/doctype/wiki_document/search.py:5`. The app has no search endpoint — `useTreeSearch.js` filters an already-loaded tree client-side. When app-side search arrives it writes to the same log with a scope flag. |
| 7 | Guest abuse | The endpoint is `allow_guest`. Cap `term` length before storing, rate-limit per session, and drop empty/whitespace queries at the door (the endpoint already returns early on those). |
| 8 | Privacy | Readers type names, emails and internal identifiers into search boxes. Store a hashed visitor id, never the raw one; keep raw terms only as long as retention allows; treat the top-searches table as an owner-only view (same gate as the rest of Overview). |
| 9 | Retention | Implement `clear_old_logs(days)` on `Wiki Search Log` and register it in `Log Settings`, matching how spec 04 handles `Web Page View`. Raw rows may be pruned more aggressively than the aggregate once a rollup exists. |
| 10 | UI | Prototype's top-searches section: term, searches, no-result rows flagged with a red badge, CTR column. The KPI strip gains searches / no-results rate / CTR beside spec 04's views and visitors, on the same divide-x rules. |
| 11 | Engine | Same call as spec 04 decision 10 — MariaDB first, same API shape, port builder's DuckDB module only against a measured need. |

## Current state

- No search logging of any kind; `Wiki Search Log` does not exist.
- `search.py:5` is `allow_guest`, returns `{results, total}`, no id.
- `search_modal.html` debounces at 200 ms and renders results with a
  `selectedIndex` — the click/enter handler there is the hook for decision 4.
- The reader loads no frappe JS bundle, so any client call is plain `fetch`
  with `window.CSRF_TOKEN` (same constraint as spec 04).

## Phases

1. **Logging.** `Wiki Search Log` doctype, write from `search.py`, `session_id`
   from the modal, `query_id` in the response. Retention registration. Unit
   tests on the write path.
2. **Click events.** `log_search_click` endpoint plus the modal's selection
   handler.
3. **Aggregation.** The 30-second collapse and the rate metrics behind
   `wiki.api.analytics.get_search_overview(range)` and `get_top_searches(range)`.
4. **UI.** KPI additions and the top-searches section on spec 04's shell.

## Regression tests

- Unit: the collapse. `k → ku → kub → kube` inside 30 s is one search recorded
  as `kube`. The same chain with a 30 s gap before the last is two searches.
- Unit: **backspace case** — `kubernetes → kube` records `kube`. This is the
  test that pins "final, not longest".
- Unit: no-results rate, CTR and abandonment over a fabricated log, including
  the multiple-clicks-count-once rule.
- Unit: term length cap and empty-query rejection.
- e2e: search in the reader, click a result, see the term appear in Overview
  with a click recorded.

## Landmines

- **Prefix rows are the default failure.** A naive write at the endpoint with
  no aggregation ships a plausible-looking, meaningless table.
- `session_id` is client-generated, so it is untrusted input — treat it as an
  opaque grouping key, never as identity, and bound its length.
- A `query_id` returned but never used by clicks leaves CTR silently at zero,
  which reads identically to "nobody clicks anything". The empty state has to
  distinguish "no click data" from "no clicks".
- Search terms are user content in a table an owner will screenshot. Decision 8
  is not optional polish.

## Open questions

- Should reader and app-side searches share one metric or split? Assumed shared
  with a scope flag until app search exists.
- Is a rollup table needed, or is on-the-fly collapse fast enough at the
  retention window? Measure in phase 3.

## Progress log

- 2026-09-08 — Spec written. Split from `04-overview-analytics.md`; counting
  model taken from Algolia (30 s aggregation, final query wins, click events
  joined by query id, metrics as rates).
