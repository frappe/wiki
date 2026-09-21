# Telemetry

One row per event Wiki sends to Pulse. This file is the only definition of an event's name and properties. A new event or property lands here in the same PR as the code.

Pulse stores one row per event with the properties as a JSON column, capped at 4096 bytes.

Telemetry is on only when the site has `pulse_api_key` in its config, `developer_mode` is off (unless `pulse_force_enabled` is set), and System Settings `enable_telemetry` is on. Self-hosted sites send nothing. Wiki adds no setting of its own.

## Questions

Shipping events exist to answer these. An event that answers none of them is planned and does not ship until a question needs it.

| # | Question | Read from |
|---|---|---|
| 1 | How many sites run wiki, and how many are active weekly | `active_site`, `site_profile` as denominator |
| 2 | Where do new sites stop | funnel: `space_created`, `change_request_created`, `change_request_merged` |
| 3 | Is wiki read, or only written | `site_profile.views_last_30d / editors_last_30d` |
| 4 | Is the change request flow a review flow, or just a save button | `change_request_merged.reviewed`, `site_profile.change_requests_open` |
| 5 | Is GitHub sync adopted, and does it work | `github_sync_enabled`, `github_sync_failed`, `site_profile.github_synced_spaces` |
| 6 | Which editor blocks earn their maintenance | `site_profile.blocks_*` |
| 7 | Do readers use feedback and search | `feedback_submitted`, `search_performed` |
| 8 | Does behaviour change after an upgrade | every event by `app_version` |
| 9 | Do spaces reach the public reader, and do they stay there | `space_published`, `space_unpublished`, `site_profile.published_spaces` |
| 10 | What do people build with: pages, groups, tabs, external links | `document_created.kind`, `site_profile.documents_*` |
| 11 | Is the generated avatar picker used, and which styles survive a save | `space_identity_set`, `site_profile.avatar_*` |
| 12 | Are generated meta images worth the Chromium cost | `meta_image_generated`, `site_profile.meta_images_*` |
| 13 | How big does a wiki get, and how is it split across spaces | `site_profile.documents`, `documents_per_space_median`, `documents_per_space_max` |

## Rules

- Name: `<object>_<verb>`, past tense, snake_case. Variation goes in properties, never in the name.
- Property keys are flat. Values are enums, booleans, small counts or buckets.
- Low cardinality only. Never page titles, slugs, space names, content, search terms, emails or document names. Count them, never name them.
- The user is always the anonymized id frappe and the Pulse client add. Wiki never passes a user.
- Backend is the default for anything that changes data. The frontend sends only what the server never sees.
- Reader pages send nothing. The plugin is installed in the `/wiki-app` SPA only, and only for a signed-in user.
- Facts about the site come from a daily scan, never from a request path.
- Backend sends through `wiki.telemetry.capture(event, **props)`, frontend through `frontend/src/telemetry.js`'s `useTelemetry().capture(event, props)`. Both add the properties every event carries. Daily events pass `interval="1d"`, which keeps one row per user per day and ignores properties.

## Properties on every event

| Property | Source | Value |
|---|---|---|
| `app_version` | `wiki.__version__`, backend directly, frontend from the SPA boot payload | e.g. `3.2.1` |
| `entry` | same | `saas_trial` when the site has a Frappe Cloud team, else `self_hosted` |
| site, user, team, timestamp | Pulse client | automatic |

## Events

| Event | Half | Fires when | Properties | Question |
|---|---|---|---|---|
| `active_site` | backend, `interval="1d"` | the `/wiki-app` SPA is served to a signed-in user | | 1 |
| `pageview` | frontend | a router navigation, on sites younger than 15 days | `route`: the matched route pattern, never the URL | 1 |

`pageview` comes from the shared `telemetryPlugin`, which wiki installs with the router. Wiki does not emit it itself.

## Planned

Everything in `specs/product_telemetry.md` phases 2 and 3: the shipping events and the daily `site_profile` scan. They land here as they ship.

## Not tracked

- Anything a guest does on the published reader. No browser telemetry is loaded there.
- Page, space and document names, and search terms. They are counted, never named.
