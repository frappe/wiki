# Space Bootstrap: One Call to Open a Space

Date: 2026-10-20
Status: **Spec.** Roadmap item 2.5 (R13) in `pr-859-roadmap.md`.

## Goal

Opening a space in the SPA waits on four requests in a row. Make it one.

## Baseline

`perf-big-1000` (1,021 pages), Administrator, fresh browser context (no tree snapshot), 100 ms added latency per request. Open `/wiki-app/spaces/<space>`, which auto-opens the first page. Median of 5 after one warm-up, on `develop` at `b68a71b3`.

| | rail painted (10+ rows) | editor visible |
| --- | --- | --- |
| 100 ms latency | 1,370 ms | 1,595 ms |

Request chain (ms from navigation):

```
   0 →  255   HTML and index.js
 311 →  396   get_user_info              (main.js, then awaited by the router guard)
 313 →  607   route chunks               (SpaceDetails, SpaceWelcome, ...)
 634 →  735   Wiki Space doc, get_space_capabilities
 748 →  851   get_or_create_draft_change_request
 856 →  965   get_cr_tree, diff_change_request
1024 → 1165   editor chunks
1252 → 1309   Wiki Document doc          (page panel)
1323 → 1417   get_cr_page
```

The space store waits for the space doc and the capabilities before it asks for a change request, and waits for the change request before it asks for the tree. Each step pays the full latency.

## Design

1. **User in the boot.** `get_boot()` adds `user_info`, the same dict `get_user_info` returns. The user store seeds its resource from `window.user_info`, so neither `main.js` nor the router guard sends a request. Login and logout both do a full page load, so the boot is never stale for the session. `reload()` still refetches.
2. **`get_space_bootstrap(space)`** in `wiki/api/wiki_space.py`, POST. Returns:
   - `doc`: the Wiki Space, as `frappe.client.get` returns it (permission check, field-level read permissions).
   - `capabilities`: what `get_space_capabilities` returns.
   - If the user may edit (logged in, not git-synced, `can_contribute`): `change_request`, `tree` and `changes`, from `get_or_create_draft_change_request`, `get_cr_tree` and `diff_change_request(scope="summary")`.
   - Otherwise: `readonly_tree`, from `get_wiki_tree`.

   It calls the existing functions, so their permission checks still apply. POST because it may create the draft change request. Item 2.4 (create the draft on first edit) will turn that into a read and the method into a GET.
3. **Space store.** One `createResource` for the bootstrap, submitted on `spaceId` change. On success it seeds the Wiki Space document resource (`doc`, `originalDoc`, `auto: false`), the capabilities, and either the read-only tree or the draft workspace through `draftStore.hydrate(spaceId, prefetched)`.
4. **`hydrate(spaceId, prefetched)`.** With `prefetched`, it adopts the change request, tree and summary instead of fetching them. Everything else stays: stale tree paint, batch hold, restoring IndexedDB drafts. Without it (after a merge, an archive, a direct `/draft/` load), it fetches as today.

The doc and the capabilities now land together. The race that `contributions-disabled.spec.ts` guards (a space doc without capabilities) can no longer happen, but the test still passes and stays.

## Phases

1. **User in the boot.** Measure. Playwright: opening the app sends no `get_user_info`.
2. **Bootstrap, editor path.** Backend method and tests. Space store and `hydrate(prefetched)`. Playwright: opening a space sends `get_space_bootstrap` and none of the four old calls.
3. **Bootstrap, read-only path.** Readers and git-synced spaces. Playwright for a reader.
4. **Update e2e tests** that hold or wait for `get_space_capabilities`, `get_or_create_draft_change_request` or the `Wiki Space` doc on load.
5. **Measure** with the baseline setup. Update `ARCHITECTURE.md`.

## Not in scope

- The page panel chain: Wiki Document doc, then `get_cr_page`. A second serial pair after the tree.
- `Wiki Settings` doc and the duplicate Pulse `boot_config` call on app load. Neither is on the space chain.
- Route chunks finishing at 607 ms. Local dev serves HTTP/1.1 with six connections per host, so chunks queue behind API calls. Production serves HTTP/2.

## Risks

- **A stale boot user** if roles change mid-session. Same as today: `get_user_info` runs once per page load, and so does the boot.
- **Bigger first response.** The bootstrap carries the tree (about 360 KB on 1,000 pages). Same bytes as today, one response instead of five.
- **2.4 and #855.** #855 adds `translated_messages` to the same `get_boot()` dict: a one-line conflict. 2.4 changes what the bootstrap does with the draft, not its shape.
