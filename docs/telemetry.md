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

### What people do

| Event | Half | Fires when | Properties | Question |
|---|---|---|---|---|
| `space_created` | backend | a Wiki Space is inserted | `visibility`: `public` when the space has no role rows, else `restricted` | 2 |
| `space_published` | backend | `is_published` flips to 1 on an existing space | `documents`: the tree under the root group. `age_days`: days since the space was created | 9 |
| `space_unpublished` | backend | the same flag flips to 0 | same two | 9 |
| `document_created` | backend | a Wiki Document is inserted under a parent | `kind`: `page`, `group`, `tab`, `external_link`. `source`: `editor`, `git_sync` | 10 |
| `change_request_created` | backend | `create_change_request` | | 2 |
| `change_request_merged` | backend | a merge finishes, fast-forward or three-way | `items`: documents the CR touched. `reviewed`: approved by someone other than the author. `conflicts`: the merge raised any | 2, 4 |
| `feedback_submitted` | backend | a Wiki Feedback row is inserted, from either API | `sentiment`: `good`, `ok`, `bad`. `has_comment`: the reader also typed something | 7 |
| `search_performed` | backend, `interval="1d"` | a search runs in the app or on the reader | `surface`: `app`, `reader`. `hits`: the search found anything | 7 |
| `command_palette_opened` | frontend | the palette is opened | `trigger`: `shortcut`, `click` | 7 |
| `space_identity_set` | frontend | the identity picker closes on a choice | `kind`: `generated`, `icon`, `logo`. `style`: the DiceBear style on a generated mark, else empty. `rolls`: times Generate was pressed first | 11 |
| `github_sync_enabled` | backend | a git-synced space is created; `git_synced` cannot be turned on later | | 5 |
| `github_sync_failed` | backend | a sync run raises | `error_kind`: `auth` (401, 403, 404), `network`, `other`, mapped from the exception class and never from its message. `trigger`: `manual`, `webhook` | 5 |
| `meta_image_generated` | backend | Chromium renders a card; a cache hit sends nothing | `outcome`: `ok`, `failed`. `trigger`: `warm`, `request`. `duration_bucket`: `lt_1s`, `1_3s`, `3_10s`, `gt_10s` | 12 |

Three things the shape of these events decides.

- A daily event's row keeps the properties of the day's *first* send: the queue dedupes on name and user alone. So `search_performed` says someone searched that day and where they searched first, not how they searched all day.
- `command_palette_opened` is not daily. The browser client has no interval, so every open is sent and the dedupe happens in the query.
- How long a space stayed published is not a property. Pulse timestamps `space_published` and `space_unpublished`, so the pair answers it without wiki storing a publish date.

## Planned

Everything in `specs/product_telemetry.md` phase 3: the daily `site_profile` scan. It lands here as it ships.

## Not tracked

- Anything a guest does on the published reader. No browser telemetry is loaded there.
- Page, space and document names, and search terms. They are counted, never named.
