# Edit opens the editor first

## Problem

Clicking **Edit** on a public page lands on `/wiki-app/spaces/<space>/page/<page>`.
The editor showed only after the space's sidebar tree had loaded and rendered.

## Reproduction

`perf-big-1000` space (1000 pages), warm cache, logged in as Administrator.
Click Edit on `/perf-big-1000/group-00/group-00-page-00` and time until
`.ProseMirror[contenteditable=true]` exists (in-page MutationObserver, median of 5).

## Findings

Request chain before the editor could mount (100 ms emulated RTT):

```
get_user_info          router beforeEach awaits it; route chunks wait too
get / capabilities     space doc, page doc, get_space_capabilities
get_or_create_draft_change_request
get_cr_tree + diff     sidebar tree, ~60 ms long task to render 1000 nodes
get_cr_page  x2        duplicate: the panel watch fires twice mid-hydrate
editor mounts
```

Root cause: `WikiDocumentPanel.loadCrPage` awaited `draftStore.hydrate`, which
resolves only after the tree, the change summary and the IndexedDB draft restore.
The editor needs none of that tree data. It needs the change request and, if one
exists, this page's unsaved IndexedDB draft.

Second serial hop: the auth guard ran in `beforeEach`, so the route's lazy chunks
only started downloading after `get_user_info` returned.

### The spaces sidebar mounted for nothing

`MainLayout` renders as soon as the user store has data, which frappe-ui restores
from its cache almost at once. The router has not finished its first navigation
yet, so `route.params.spaceId` is empty and the sidebar slot picks
`LibrarySidebar`. It mounted at ~90 ms, fired `get_count`, the Wiki Space list and
`get_restricted_spaces`, then was replaced by `SpaceSidebar` at ~170 ms. This
happens on `develop` too, independent of the changes below.

## Fix

- `MainLayout` mounts `LibrarySidebar` only after `router.isReady()`, so a direct
  load of a space route never builds the spaces list.

- `draftStore.hydrateForPage(space, docKey)` waits for the change request and its
  saved drafts, not the tree. If this page has a saved draft, it still waits for
  the full hydrate, because restoring a draft checks it against the tree.
- Saves stay queued until the tree lands (`transport.holdBatches`). The tree
  carries `operation_version`; without it the server skips its conflict check.
- `loadCrPage` shares one in-flight `get_cr_page` per page.
- The user fetch starts in `main.js`, shares one request, and the auth guard moved
  to `beforeResolve` so route chunks download alongside it.

## Results

| | before | after |
|---|---|---|
| editor visible, 100 ms RTT | 1018 ms | 713 ms |
| editor visible, local | 524 ms | 326 ms |

The editor now mounts before the sidebar tree instead of ~190 ms after it.

## Tests

`e2e/tests/edit-opens-before-tree.spec.ts`, each verified failing with its part of
the fix reverted:

- Edit opens the editor while `get_cr_tree` is held, and never mounts the spaces
  sidebar or requests the space list.
- A save typed before the tree lands is not sent until the tree lands.
- An unsaved draft of the page reopens after a reload.

## Not changed

- Capabilities and the change request stay serial: asking a reader's space for a
  change request answers 403.
- Pre-existing: public-page specs (`accept-contributions`, `stale-tab-flags`,
  `public-pages`) time out on `waitForLoadState('networkidle')` with and without
  this change, because `make_view_log` never reports finished in Chromium.
