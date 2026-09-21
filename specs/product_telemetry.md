# Product Telemetry

Date: 2026-09-19
Date revised: 2026-09-21
Status: **Phases 0 and 1 done. Phase 2 next.** Research against frappe `develop` (71d55e2), frappe-ui `main` @ `1.0.0-beta.76`, and insights / helpdesk / crm / builder / lms / gameplan `develop`.

## Problem

Wiki sends no product telemetry. We cannot tell how many sites use the app, which features get used, or where new users stop. Every other Frappe product reports to Pulse. Wiki should too, using the same shared plugin and the same consent rules.

## How other apps do it

Two halves, both ending in Pulse (`pulse.m.frappe.cloud`).

### Backend: `frappe.utils.telemetry.capture`

```python
from frappe.utils.telemetry import capture

capture("active_site", "helpdesk")
capture("builder_page_created", "builder", properties={...})
```

- `capture` is a no-op unless telemetry is on (see Consent). It never raises.
- It anonymizes the user (site-salted sha256, `user_<12 hex>`), adds site and `fc_team`, and pushes to a Redis queue. A frappe scheduler job (`send_queued_events`) flushes the queue to Pulse.
- `interval="1d"` keeps one row per user per day and ignores properties. Good for "was this used today" events.
- Every app calls `capture("active_site", "<app>")` in its SPA's `www` `get_context` for non-guest users.
- Domain events live in the controller or API that owns the action.
- `app_heartbeat` is free. `frappe/api/__init__.py` calls `capture_app_heartbeat(app)` on every `/api/method/wiki.*` request, throttled to once per 6h. Wiki already gets it with no code.

### Frontend: `telemetryPlugin`

```js
import { telemetryPlugin } from '@framework/ui';
app.use(telemetryPlugin, { app_name: 'wiki', router });
```

On install the plugin calls `frappe.utils.telemetry.pulse.client.boot_config` (whitelisted, guest allowed). That returns `{enabled: false}` when telemetry is off, else the Pulse host, a public write-only ingest key, site, anonymized user, team and `site_age`. The plugin then imports the Pulse browser client from Pulse's CDN and posts events straight to Pulse. The frappe backend is not in that path. With `router` passed it captures a `pageview` per navigation on sites younger than 15 days, using the route pattern (`/spaces/:spaceId`), never the real URL.

### Where the plugin lives now

| Location | Status |
|---|---|
| `frappe-ui/frappe` (`telemetryPlugin`) | Removed in frappe-ui `1.0.0-beta.41` (2026-08-09). CRM, Builder and LMS still import it because they pin older frappe-ui. |
| `@framework/ui` (`frappe/ui/src/telemetry`) | Current home, since frappe/frappe#41671 (2026-08-08). Insights and Helpdesk `develop` use it. |

Wiki ships frappe-ui `1.0.0-beta.76`, which has no `frappe-ui/frappe` export, so "the frappe-ui plugin" for wiki means `@framework/ui`. It is not on npm: raw source in the frappe repo, linked by relative path, compiled by the host app's Vite. Peer dependency is `frappe-ui >=1.0.0-beta.63`.

### Insights, the one worth copying

Helpdesk and Gameplan install the plugin and sprinkle `capture(...)` calls. Insights (`develop`) treats telemetry as a product with a spec, and it is the model this spec follows.

- **`docs/telemetry.md` is the only definition of an event.** Name, when it fires, every property, and which feature it covers. A new event or property lands in that file in the same PR as the code.
- **Events answer a numbered question.** The file opens with a question table ("where do new sites stop", "is the SQL editor worth investing in") and each one names the events that answer it. An event that answers no question is listed under Planned and does not ship.
- **Naming rules are fixed.** `<object>_<verb>`, past tense, snake_case. Variation goes in properties, never in the name: `query_created {interface: sql}`, not `sql_query_created`. Property keys are flat.
- **Low cardinality only.** Enums, booleans, counts, buckets. Never user text, titles, SQL, emails or record ids. Big numbers become buckets (`rows_bucket`, `duration_bucket`) through one helper.
- **One wrapper per half adds the shared properties.** `insights/telemetry.py:capture` wraps frappe's and adds `app_version` and `entry` (`erpnext_site`, `saas_trial`, `self_hosted`), swallowing every exception. `frontend/src2/telemetry.ts` wraps `useTelemetry()` and adds the same two, read from a boot API.
- **Facts about the site are a daily scan, not clicks.** `insights/telemetry_scan.py` runs from the scheduler and sends `site_profile`, `site_queries`, `site_tables`: counts of what exists, plus a timeline from `creation` timestamps. The first send covers sites that installed long ago, which no click event can do. It is split into three events to stay under the 4096-byte property cap, and it asks nothing of a site that has telemetry off.
- **Daily events use `interval="1d"`**, so "opened a workbook" is one row per user per day rather than a click stream.
- **Retired and Not tracked are written down.** Retired names say what replaced them. Not tracked says which behaviours are guarantees, not decisions.
- **Tests per event group.** `insights/tests/test_telemetry*.py`, six files.
- The plugin is installed only once the user is signed in (`watchEffect` on `session.isLoggedIn`).

Wiki is a smaller app and does not need 40 events. It does need the parts that keep telemetry honest: the catalogue file, the question table, the naming and privacy rules, one wrapper per half, and a daily scan.

## Consent

Wiki adds no setting. Telemetry is on only when all of these hold (`pulse/client.py:is_enabled`):

1. `pulse_api_key` is in site config. Frappe Cloud sets it. Self-hosted sites do not have it, so they never send anything.
2. `developer_mode` is off, unless `pulse_force_enabled` is set.
3. System Settings `enable_telemetry` is on. The admin opts out in the setup wizard or in System Settings.

Both halves read the same gate. Turning it off stops the server queue and makes `boot_config` return `{enabled: false}`, so the browser client never loads.

## Rules for wiki events

Same rules as insights, restated so this repo has them.

- Name is `<object>_<verb>`, past tense, snake_case. Variation goes in properties.
- Property keys are flat, values are enums, booleans or small counts.
- Never send page titles, slugs, space names, content, search terms, emails or document names. Count them, never name them.
- The user is always the anonymized id frappe and the plugin add. Wiki never passes a user.
- Backend is the default for anything that changes data: it runs once per real action, ad blockers cannot stop it, and it is easy to unit test. The frontend sends only what the server never sees.
- Reader pages (Jinja, mostly guests) send nothing from the browser. The plugin is installed only in the `/wiki-app` SPA, and only for a signed-in user.
- Facts about the site come from the daily scan, never from a request path.
- A new event or property lands in `docs/telemetry.md` in the same PR as the code.

### Properties on every event

| Property | Source | Value |
|---|---|---|
| `app_version` | backend default, frontend from the SPA boot payload | `wiki.__version__` |
| `entry` | backend, cached daily, frontend from boot | `saas_trial` when the site has a Frappe Cloud team, else `self_hosted` |
| site, user, team, timestamp | Pulse client | automatic |

## Questions

Events exist to answer these. An event that answers none stays in Planned.

| # | Question | Read from |
|---|---|---|
| 1 | How many sites run wiki, and how many are active weekly | `active_site`, `site_profile` as denominator |
| 2 | Where do new sites stop | funnel: `space_created`, `change_request_created`, `change_request_merged` |
| 3 | Is wiki read, or only written | `site_profile.views_last_30d / editors_last_30d` |
| 4 | Is the change request flow used as a review flow, or just a save button | `change_request_merged.reviewed`, `site_profile.change_requests_open` |
| 5 | Is GitHub sync adopted, and does it work | `github_sync_enabled`, `github_sync_failed`, `site_profile.github_synced_spaces` |
| 6 | Which editor blocks earn their maintenance (mermaid, callouts, PDF embeds) | `site_profile.blocks_*` |
| 7 | Do readers use feedback and search | `feedback_submitted`, `search_performed` |
| 8 | Does behaviour change after an upgrade | every event by `app_version` |
| 9 | Do spaces reach the public reader, and do they stay there | `space_published`, `space_unpublished`, `site_profile.published_spaces` |
| 10 | What do people build with: pages, groups, tabs, external links | `document_created.kind`, `site_profile.documents_*` |
| 11 | Is the generated avatar picker used, and which styles survive a save | `space_identity_set`, `site_profile.avatar_*` |
| 12 | Are generated meta images worth the Chromium cost | `meta_image_generated`, `site_profile.meta_images_*` |
| 13 | How big does a wiki get, and how is it split across spaces | `site_profile.documents`, `documents_per_space_median`, `documents_per_space_max` |

## Plan

### Phase 0: prerequisites

**Done, 2026-09-21.**

1. **Upgrade frappe-ui from `1.0.0-beta.55` to `1.0.0-beta.76`.** Done upstream as its own spec and PR (frappe/wiki#800, merged into `develop`), as planned. `@framework/ui` needs at least beta.63, so the floor is clear.
2. **Link `@framework/ui` into `frontend/`.** Done. Two changes, both in `frontend/`:
   - `package.json`: `"@framework/ui": "link:../../frappe/ui"`.
   - `vite.config.js`: `frameworkUI()` from `@framework/ui/vite`, added to `plugins`.

   Three things came out different from the plan.

   - **The bundled plugin, not a hand-written `dedupe` list.** Insights predates the plugin and dedupes by hand. `frameworkUI()` does that and one thing more: it re-runs the host app's resolver for bare imports inside the package. That second half is load-bearing here. `@framework/ui` lives in the frappe repo, which does not depend on frappe-ui, so a bare `frappe-ui` import inside it resolves to nothing without the plugin. Measured, resolving `frappe-ui` from `frappe/ui/src/telemetry/telemetry.ts`: `undefined` without the plugin, this app's copy with it. `vue` and `vue-router` resolve to this app's copies either way, because nothing else pulls a second one into the graph, but the dedupe keeps that true when one arrives.
   - **`optimizeDeps.exclude` was not needed.** Vite does not pre-bundle a symlinked dependency, so `@framework/ui` is served as source already. Nothing added.
   - **Subpath imports need the explicit file.** The `"./*"` export maps to `./src/*` with no extension resolution, so `@framework/ui/telemetry` fails to resolve and `@framework/ui/telemetry/index.ts` works. That is the form insights uses, and the form Phase 1 should use.

   README step 2 (`tsconfig.json` paths) does not apply: the wiki frontend is plain JS and has no tsconfig.

   Verified: `yarn build` green, `@framework/ui/telemetry/index.ts` imports and compiles from `src/main.js` (probe, reverted). Linking pulls `@framework/ui`'s own deps into `yarn.lock` (leaflet, cropperjs, vuedraggable and a second `sortablejs`). None of them reach the bundle unless a component that imports them is imported; telemetry imports none.

### Phase 1: tracer bullet

**Done, 2026-09-21.** One event per half, end to end, plus the catalogue file, before any more events.

- `docs/telemetry.md`: the question table, the rules, and the two events below.
- `wiki/telemetry.py`: `capture(event, interval=None, **props)` wrapping frappe's, adding `app_version` and `entry`, swallowing every exception. About 20 lines, copied from insights.
- Backend: `capture("active_site")` in `wiki/www/wiki_app.py:get_context` for non-guest users.
- Frontend: `frontend/src/telemetry.js` wrapping `useTelemetry()` with the same two properties (served from `get_boot`), and `app.use(telemetryPlugin, { app_name: 'wiki', router })` in `main.js` once the user is signed in. `router` gives `pageview` on new sites for free.
- Done when one `active_site` sits in the server queue and one `pageview` leaves the browser with `app: "wiki"`.

Both verified on `wiki.localhost` with `pulse_api_key` and `pulse_force_enabled` set:

- `GET /wiki-app` as Administrator queued `{"app": "wiki", "event_name": "active_site", "properties": {"app_version": "3.2.1", "entry": "self_hosted"}}`. A guest sends nothing.
- Playwright with `boot_config` and the Pulse CDN client stubbed captured `{"event_name": "pageview", "app": "wiki", "props": {"route": "/"}}`. The stub is `e2e/tests/telemetry.spec.ts`, so no test ever reaches Pulse.

Two things came out different from the plan.

- **The shared properties ride on the existing boot payload, not a new API.** `wiki_app.py:get_boot` already feeds `window.<key>` for every key it returns, so `get_boot` gained one key, `telemetry`, holding `{app_version, entry}`. Insights needs `get_site_info` because its SPA has no such payload. No new whitelisted method here.
- **`frontend/src/telemetry.js` has no caller yet.** Phase 1's frontend event is `pageview`, which the plugin sends itself. The wrapper is what Phase 2's browser events go through, and it is what keeps `app_version` and `entry` on them.

`get_debug_info(fetch_events=...)` returns an empty list on a non-empty queue (`lindex` against the list it `lpush`es), so the queue was read with `frappe.cache.lrange` instead. Frappe bug, not wiki's; worth reporting.

### Phase 2: shipping events

| Event | Half | Fires when | Properties | Question |
|---|---|---|---|---|
| `space_created` | backend | `WikiSpace.after_insert` | `visibility: public, restricted` | 2 |
| `change_request_created` | backend | `create_change_request` | | 2 |
| `change_request_merged` | backend | `merge_change_request` | `items: int`, `reviewed: bool`, `conflicts: bool` | 2, 4 |
| `github_sync_enabled` | backend | a space's GitHub sync is first saved (exact hook to be confirmed while building) | | 5 |
| `github_sync_failed` | backend | a sync or webhook run fails | `error_kind: auth, network, conflict, other` | 5 |
| `feedback_submitted` | backend | `wiki_feedback.submit_feedback` | `helpful: bool` if the doctype records one | 7 |
| `search_performed` | backend, `interval="1d"` | `api/search.py:search_pages` | `surface: app, reader`, `hits: bool` | 7 |
| `command_palette_opened` | frontend, `interval="1d"` | `CommandPalette.vue` opens | `trigger: shortcut, click` | 7 |
| `space_published` | backend | `WikiSpace.on_update`, `is_published` flips to 1 | `documents: int`, `age_days: int` | 9 |
| `space_unpublished` | backend | same hook, flips to 0 | `published_days: int` | 9 |
| `document_created` | backend | `WikiDocument.after_insert` | `kind: page, group, tab, external_link`, `source: editor, git_sync` | 10 |
| `space_identity_set` | frontend | a space's mark is saved in `SpaceIdentityPicker` or `NewSpaceDialog` | `kind: generated, icon, logo`, `style: glass, blobs, waves, loops`, `rolls: int` | 11 |
| `meta_image_generated` | backend | `og_image._generate_and_store` returns or raises | `outcome: ok, failed`, `trigger: warm, request`, `duration_bucket` | 12 |

Notes on three of them.

- `document_created` carries `source` because git sync inserts a whole repo at once. A 400-page import would otherwise read as 400 authoring events. If the volume still drowns the editor signal, drop the `git_sync` source and let the scan count synced documents instead.
- `space_identity_set` is the only sensible place for question 11: the roll happens entirely in the browser (`lib/spaceAvatar.js`, DiceBear rendered locally), and only the saved mark reaches the server. `rolls` is how many times Generate was pressed before the save, which says whether one roll is usually enough. The scan counts what survived; this event counts the trying.
- `meta_image_generated` fires on generation, not on serving. A cache hit sends nothing, so the volume is bounded by documents and fingerprint changes, not by crawler traffic. `duration_bucket` is what tells us whether Chromium is affordable.

`error_kind` and `duration_bucket` come from one function each, as in insights. `error_kind` is mapped from exception classes, never from the message.

### Phase 3: daily site scan

One scheduler job, `wiki/telemetry_scan.py`, sending `site_profile`. It answers questions 1, 3, 4, 5 and 6 for every site, including sites that installed wiki long ago and never trip a click event. It reads only wiki's own tables, and it sends nothing when telemetry is off.

| Group | Properties |
|---|---|
| Identity | `frappe_cloud: bool`, `site_age_days`, `wiki_installed_days_ago` |
| Timeline | `first_space_days_ago`, `first_page_days_ago`, `last_merge_days_ago` |
| Spaces | `spaces`, `published_spaces`, `restricted_spaces`, `github_synced_spaces`, `spaces_with_tabs`, `spaces_accepting_contributions`, `spaces_with_feedback_on` |
| Documents | `documents`, `published_documents`, `documents_group`, `documents_tab`, `documents_external_link`, `documents_per_space_median`, `documents_per_space_max` |
| Identity marks | `avatar_generated`, `avatar_icon`, `avatar_logo`: spaces by mark kind, and `avatar_glass`, `avatar_blobs`, `avatar_waves`, `avatar_loops` from `Wiki Space.avatar_style` |
| Meta images | `meta_images_enabled: bool` from Wiki Settings, `documents_with_uploaded_meta_image`, `cached_cards` |
| Review | `change_requests_open`, `change_requests_merged` |
| Content | `blocks_mermaid`, `blocks_callout`, `blocks_pdf`, `blocks_image`, `blocks_table`: spaces using each block type, not a body scan of every revision |
| People | `editors_last_30d`, `viewers_last_30d`, `views_last_30d` from `Wiki Page View Daily`, which wiki already aggregates |

The document and space counts are one grouped SQL query each, so the scan stays cheap on a big wiki. `documents_per_space_*` answers question 13 without ever naming a space: a median and a max, never a per-space list.

One event, so it must stay under the 4096-byte cap. Split only if it grows.

## Testing

### Local

```bash
bench --site wiki.localhost set-config pulse_api_key test-key
bench --site wiki.localhost set-config pulse_force_enabled 1
```

and turn on `enable_telemetry` in System Settings. Remove both keys afterwards.

- Server: `frappe.utils.telemetry.pulse.client.get_debug_info(fetch_events=20)` as Administrator lists queued events. The flush fails against the real host with a fake key, which is fine, we only check the queue.
- Browser: the client posts to `https://pulse.m.frappe.cloud`. Watch it in devtools, or intercept it in Playwright.

### Automated

- Unit tests in `wiki/tests`, split by group like insights (`test_telemetry.py`, `test_telemetry_scan.py`): patch `wiki.telemetry.capture` and assert each event fires once with the expected name and properties, that `active_site` does not fire for Guest, and that the scan sends nothing when telemetry is off. Temp revert each call to prove the test fails.
- One test asserting every event name emitted by the code appears in `docs/telemetry.md`. That is what keeps the catalogue true.
- One Playwright test: `page.route` the Pulse CDN client url and serve a stub `PulseClient` that records captures on `window`, with `boot_config` stubbed to `enabled: true`. Assert `pageview` on load and `command_palette_opened` on Cmd K. No real network, so no flake.

## Open questions

1. **Frappe v16 builds.** `pyproject.toml` allows `frappe >=16.0.0-dev`, but `frappe/ui` exists only on frappe `develop`. After Phase 0 the wiki frontend will not build on a v16 bench. Helpdesk and insights accepted that. Can wiki `develop` require frappe `develop` too? If not, the fallback is a local copy of `ui/src/telemetry/pulse.ts` (about 30 lines: call `boot_config`, import the same CDN client) and a switch to `@framework/ui` later.
2. ~~**Who does the frappe-ui upgrade.**~~ Resolved: it landed upstream as frappe/wiki#800 before this branch rebased onto it.
3. **Scan cost.** The `blocks_*` counts need a way to tell which block types a space uses without scanning every revision body. If wiki has no cheap source, drop question 6 from Phase 3 and measure block usage from the editor instead.
4. **Event list.** Anything else the product team wants measured.

## Progress log

- 2026-09-19: Spec drafted.
- 2026-09-20: Reworked around the insights `develop` model: catalogue file, question table, naming and privacy rules, per-half wrapper, daily site scan.
- 2026-09-20: Added questions 9 to 13 and their events: space publish and unpublish, document kind on create, the generated avatar picker, meta image generation, and wiki size per space in the scan.
- 2026-09-21: Phase 0 pins the frappe-ui target at the latest tag, `1.0.0-beta.76`, and calls the upgrade a separate blocking spec.
- 2026-09-21: Phase 1 done. `wiki/telemetry.py`, `active_site` from the app shell, the boot-served shared properties, `frontend/src/telemetry.js`, the plugin installed for signed-in SPA users, `docs/telemetry.md`, unit tests and one stubbed Playwright test.
- 2026-09-21: Phase 0 done. Rebased onto `develop` for the frappe-ui beta.76 upgrade, linked `@framework/ui` and added the `frameworkUI()` vite plugin. Open question 2 resolved.
