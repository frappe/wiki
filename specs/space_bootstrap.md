# Space Bootstrap: Fewer Requests to Open a Space

Date: 2026-10-20
Status: **Done** (2026-10-20). Roadmap item 2.5 (R13) in `pr-859-roadmap.md`.

## Goal

Opening a space in the SPA waits on four requests in a row. Cut the chain.

## Baseline

`perf-big-1000` (1,021 pages), Administrator, fresh browser context (no tree snapshot), 100 ms added latency per request. Times come from an in-page MutationObserver: 10 tree rows in the sidebar (rail), and `.ProseMirror[contenteditable=true]` (editor). Median of 5 after one warm-up, on `develop` at `b68a71b3`.

Request chain when opening `/wiki-app/spaces/<space>` (ms from navigation):

```
 311 →  396   get_user_info              (main.js, then awaited by the router guard)
 313 →  607   route chunks               (SpaceDetails, SpaceWelcome, ...)
 634 →  735   Wiki Space doc, get_space_capabilities
 748 →  851   get_or_create_draft_change_request
 856 →  965   get_cr_tree, diff_change_request
```

The space store waits for the space doc and the capabilities before it asks for a change request, and waits for the change request before it asks for the tree. Each step pays the full latency.

## Design

1. **User in the boot.** `get_boot()` adds `user_info`, the same dict `get_user_info` returns. The user store seeds its resource from `window.user_info`, so neither `main.js` nor the router guard sends a request. `get_user_info` now returns roles as `{role}` dicts, because the boot is rendered with Jinja's plain-json `tojson`, which cannot serialize child rows. The user store no longer caches in IndexedDB: a cached copy from an earlier session could replace the boot user before any fetch.
2. **`get_space_bootstrap(space_id)`** in `wiki/api/wiki_space.py`, POST. Returns `doc` (the Wiki Space, as `frappe.client.get` returns it), `capabilities` (as `get_space_capabilities` returns them) and `change_request`: the user's draft from `get_or_create_draft_change_request` if they can contribute and the space is not git-synced, else `null`. It calls the existing functions, so their permission checks still apply. POST because it may create the draft. Item 2.4 (create the draft on first edit) will make it a read.
3. **Space store.** The Wiki Space document resource no longer fetches itself (`auto: false`). One bootstrap request per space change seeds the document, the capabilities and the draft. The hydrate watcher passes the draft to `draftStore.hydrate(spaceId, changeRequest)`, which skips `get_or_create_draft_change_request`. Everything after that is unchanged: the tree and the summary load in parallel, the stale tree paints from IndexedDB, saves wait for the tree.

## Decision: the tree stays out of the bootstrap

The first prototype put the draft tree and summary (or the read-only tree) in the bootstrap too. One request, fastest rail. But it removes the state where the change request is known and the tree is not, and three behaviours depend on it:

- The editor opens before the tree (`edit_opens_editor_first.md`). With the tree in the bootstrap, the page fetch also waits for the 1,000-row tree to be applied.
- A failed tree load offers Reload latest. With the tree in the bootstrap, a failed tree load fails the whole space and leaves it on a skeleton.
- Saves wait for the tree's `operation_version`.

Measured both (median ms, 100 ms latency):

| | develop | tree in bootstrap | without tree |
| --- | --- | --- | --- |
| Space URL: rail | 1,020 | 811 | 920 |
| Space URL: editor | 1,523 | 1,317 | 1,428 |
| Page URL (Edit): rail | 1,252 | 919 | 1,154 |
| Page URL (Edit): editor | 1,179 | 1,136 | 1,072 |

Without the tree, the Edit flow opens the editor fastest, and recovery stays as it is. The rail pays one more round trip than the prototype.

## Results

Request chain after (space URL):

```
 316 →  411   get_translations, Wiki Settings doc (not on the space chain)
 627 →  731   get_space_bootstrap
 ...          get_cr_tree, diff_change_request
```

Four serial requests before the tree become two: bootstrap, then tree. Before the editor's page fetch, three become one.

## Tests

- `wiki/test_api.py`: `TestAppBoot` (the boot carries the user, plain-json, guest is logged out), `TestSpaceBootstrap` (editor gets a draft, a reader who cannot contribute gets none and none is created, a git-synced space gets none, an outsider is refused).
- `e2e/tests/space-bootstrap.spec.ts`: opening a space sends one `get_space_bootstrap` and no `get_user_info`, `get_space_capabilities`, `get_or_create_draft_change_request` or Wiki Space doc request. Fails on the old frontend.
- Updated `contributions-disabled.spec.ts` (delays the bootstrap instead of the capabilities) and `change-request-flow.spec.ts` (reads the draft from the bootstrap response).

## Not in scope

- The page panel chain: Wiki Document doc, then `get_cr_page`.
- `Wiki Settings` doc and the duplicate Pulse `boot_config` call on app load. Neither is on the space chain.
- Route chunks finishing at about 600 ms. Local dev serves HTTP/1.1 with six connections per host, so chunks queue behind API calls. Production serves HTTP/2.

## Risks

- **A stale boot user** if roles change mid-session. Same as before: `get_user_info` ran once per page load, and so does the boot.
- **A failed bootstrap** leaves the space on its skeleton. Same as a failed space doc load before.
- **#855** adds `translated_messages` to the same `get_boot()` dict: a one-line conflict.
