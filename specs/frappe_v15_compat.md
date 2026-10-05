# Frappe v15 compatibility

Issue: https://github.com/frappe/wiki/issues/826

## Why?

Wiki v3 only installs on Frappe v16 and later. Many sites still run v15 and ask for a v15 build (see the forum thread "Why is there no version-15 for Wiki app?"). Installed on a v15 bench today, wiki fails to install, then serves a 500 on every reader page and on `/wiki-app`, and `bench migrate` aborts on any site that already has an older wiki.

## What?

One codebase that installs, upgrades and runs on Frappe v15 and v16+.

- Same features on both, except auto-generated OG images. They need the headless-Chromium renderer that ships with Frappe v16 (`frappe.utils.preview`). On v15 the cards are off: no `og:image` tag for them, the endpoint returns 404, and the Wiki Settings toggle is hidden. An uploaded meta image still works.
- CI runs server and UI tests on Frappe `version-15` as well as `develop`.

Out of scope: framework-side gaps that wiki cannot fix on its own.

- `frappe.utils.telemetry.pulse.client.boot_config` is missing in v15, though the `@framework/ui` telemetry that calls it was backported. The SPA logs one failed call per load and pageview telemetry stays off. Needs a frappe backport.
- v15's `make_view_log` has no `content` argument, so `utm_content` is not recorded.

## How?

Detect the feature where an API is simply missing. Check the version only where the API is the same and the behaviour differs.

| Break on v15 | Fix |
|---|---|
| `requires-python >=3.14`, `frappe >=16` | `requires-python >=3.10`, `frappe >=15.0.0,<=17.0.0-dev` |
| `frappe.utils.preview` import fails, so every reader page 500s | Guarded import in `wiki/api/og_image.py`. `cards_supported()` is false without it, and `cards_enabled()` gates the tag, the endpoint and the warm-up. The boot flag `meta_images_supported` hides the settings toggle |
| `frappe.local.response_headers` missing, so `/wiki-app` 500s | `hasattr` guard. The robots meta tag in `wiki-app.html` already covers it |
| `search_pages` 500s: `Column 'modified' in ORDER BY is ambiguous` | Qualify `order_by` with the table name |
| `SQLiteSearch.index_doc` appends a row on every save, so search shows duplicates | `WikiSQLiteSearch.index_doc` removes the old row first, on v15 only. On develop `index_doc` queues, so deleting first would hide the page until the queue drains |
| Patch `update_desktop_icon_link` filters on `icon_type`, which v15 lacks, so migrate aborts | Return early when the column is missing |
| Reader imports `/assets/frappe/js/lib/fingerprintjs.js`, absent in v15, so no page views are logged | `fingerprint_js_url()` picks the bundled copy when frappe ships one, else the CDN URL v15's own `website_script.js` uses |
| Tests import `IntegrationTestCase` / `UnitTestCase` and call `self.change_settings` | One version-aware base, as CRM does: `wiki.tests.WikiTestCase` is `IntegrationTestCase` on v16+ and a `FrappeTestCase` subclass with `change_settings` on v15. Every test file imports it under its old name, e.g. `from wiki.tests import WikiTestCase as FrappeTestCase` |

## Testing

- Regression test per fix, each confirmed to fail with the fix reverted.
- Full server suite and Playwright suite on a stock Frappe v15 bench.
- Upgrade path: a site on wiki develop from June 2025 (pre-v3) migrates to this branch on v15.

## Progress

- [x] Reproduce every break on a v15 bench (install, unit, E2E, upgrade)
- [x] Fixes and regression tests
- [x] Server suite on stock v15: 630 run, all pass (1 skipped)
- [x] Playwright suite on stock v15: all pass. The card spec takes its no-renderer branch
- [x] Server suite on Frappe develop: 708 run, all pass (1 skipped)
- [ ] Playwright suite on Frappe develop: left to CI
- [x] Upgrade from June 2025 wiki on v15 migrates and serves pages
- [x] CI matrix: `version-15` and `develop`
- [x] `spaces-publish-filter` E2E: clicked the hidden sidebar link under load. Now waits for the list row
