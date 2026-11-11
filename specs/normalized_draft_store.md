# Normalized Draft Store: One Tree, One Title, One Deleted Flag

Date: 2026-11-11
Status: **Built**. Vitest step and bullets 1 to 4 built. Roadmap item 3.5 (R5) in `pr-859-roadmap.md`. Stacked on #932 (`specs/durable_draft_sync.md`).

## Goal

Each fact about a page in the draft tree is stored once. The sidebar, the page panel, the link picker and the navigation code read it from the same place, so they cannot disagree.

## Why

Reproduced in a browser on the stack head (`c1feca3a`, #932 rebased on `develop`).

| Scenario | What happens today |
|---|---|
| Delete a page offline, then restore it | The row stays struck through and cannot be opened, also after a browser reload, until the server answers. Restore again does nothing |
| Delete a page and let it land, then restore it offline | The row stays struck through until the server answers |
| Tab B renames a page that tab A has open. A retried batch in tab A reloads its tree | The sidebar shows the new title. The heading, the breadcrumb and the browser tab keep the old one |
| Change one field of one row in a 1,020-page space | `treeAsLegacy` rebuilds all 1,020 nodes (5.5 ms median), then `WikiTree` deep-watches it and copies it again |

Root causes:

1. "Deleted" is three signals: `node.isDeleted`, `localStatus === 'pending_delete'` and the change summary's `deleted` type. Restore clears only the first. `denormalizeNode` ORs in the second, and `WikiTree` ORs in the third, which changes only when the server answers.
2. A page's title, route and publish flag live on the tree node and again on its page buffer. A tree load writes the node and a page fetch writes the buffer. The sidebar reads the node and the panel reads the buffer.
3. The tree is a nested array. Every reader walks it, and each view layer rebuilds it on every change.

### Tree copies

| Copy | Written by | Read by |
|---|---|---|
| `tree`, nested, camelCase (`treeModel.js`) | `applyServerTree`, `applyEntry`, `applyAcknowledged` | Store actions, `findNode`, `__draftStore` |
| `treeAsLegacy`, computed snake_case copy | Rebuilt from `tree` on any change | `space.js` `treeData`, and through it the sidebar, `SPACE_TREE_KEY` (both panels, editor link picker, reader breadcrumbs), `SpaceDetails`, `SpaceWelcome`, `useStartEditing` |
| `treeNodes` in `WikiTree.vue` | Deep watch on its `items` prop, adds `label` | frappe-ui `Tree` |
| Stale tree and `staleTreeAsLegacy` | IndexedDB snapshot, a second `createTreeModel` | `treeData` before the draft tree loads |
| `liveTreeData` in `space.js` | `adaptReadonlyNode` over `get_wiki_tree` | `treeData` outside a draft |

### Title fields

| Field | Written by | Read by |
|---|---|---|
| `node.title` | Server tree, `applyFields`, `applyAcknowledged`, `insertCreatedNode` | Sidebar, breadcrumb ancestors, link picker, tree search |
| `page.title` (buffer) | Page fetch, draft restore, `applyFields` and `applyAcknowledged` when a buffer exists, `reconcileEditorContent` | Page heading, browser tab |
| `title` in the persisted draft | `persistEditorDraft` | Draft restore, only when the server is unreachable |
| `crPage.title` in `DraftContributionPanel` | Copied from the buffer on every buffer change | `editableTitle` |
| `currentCrPage.title`, `wikiDoc.doc.title` in `WikiDocumentPanel` | Fetches | Fallbacks in `displayTitle` |
| `editableTitle` in both panels | The input, reset from the fields above | Title input, last breadcrumb |
| `label` | `WikiTree` copy of the title. `get_cr_tree` also sends one, unused | Drag ghost, typeahead |

Route and publish flag have the same split between node and buffer. `restoredDraftBuffer` already carries a comment about an earlier bug from it: the buffer said published while the tree said unpublished.

### Deleted signals

| Signal | Written by | Read by |
|---|---|---|
| `node.isDeleted` | Server `is_deleted`, delete and restore over the subtree | `restoreNode`, `reloadPage`, e2e |
| `localStatus === 'pending_delete'` | Delete only. Cleared when the server answers and no later entry exists | `denormalizeNode` |
| Change summary `deleted` | Each batch reply, `loadChanges` | `WikiTree.isDeleted` only |
| `is_deleted` in `treeAsLegacy` | `isDeleted` OR `pending_delete` | `WikiTree`, `firstPageIn`, `SpaceDetails` redirect, `linkablePages` |

The readers disagree: `WikiTree` adds the summary, the other three do not.

`localStatus` also drives the sync dot. It mirrors "the log holds an entry for this page", which the operation log already knows. `orderIndex` is stored and never read. `enqueueMutation`, `setMutationStatus`, `clearMutation`, `_normalizeNode` and `_denormalizeNode` have no callers.

## Target shape

```js
// createTreeModel()
rootKey: 'r00t',
nodesById: {
	[docKey]: {
		docKey, parentKey, documentName,
		title, route, isGroup, isTab, tabIcon,
		isPublished, isExternalLink, externalUrl,
		isDeleted,
	},
},
childIds: { [parentKey]: [docKey, ...] }, // childIds[rootKey] is the top level
```

Rules:

- A record holds the server's copy with the log replayed on top. Nothing else writes it.
- Order lives only in `childIds`. No `orderIndex`.
- `isDeleted` is the only deleted flag. Delete and restore set it over the subtree, as the server does.
- Sync state is not stored. A page is pending while the log holds an entry for it.
- The page buffer holds content only: `content`, `localContent`, `serverContent`, `serverHash`, `sentContent`, `saveStatus`, `error`. Title, route and publish flag come from the record.

Selectors are plain functions of the model in `treeModel.js`:

| Selector | Replaces |
|---|---|
| `findNode(docKey)`, now a lookup | Recursive `findNode` |
| `children(parentKey)` | `getChildList`, `node.children` |
| `trail(docKey)` | `trailToNode`, `findAncestorKeys` in `WikiDocumentList` |
| `nodeByDocumentName(name)` | `findNodeByDocumentName` in `SpaceDetails`, the scan in `WikiTree.isSelected` |
| `firstPage(parentKey)` | `firstPageIn` |
| `linkablePages()` | The walk in `page-links.js` |
| `pages()`, flat in tree order | `flatten` in `useTreeSearch` |
| `isPending(docKey)` | `localStatus` |

frappe-ui `Tree` needs nested nodes. `WikiTree` builds them in one computed from `children()`, as `{ doc_key, label, children }` per row, and the row reads everything else from `findNode`. It is the only nested copy and holds no page data. No deep watch.

The stale snapshot and the live tree outside a draft load into `createTreeModel` instances too. `space.js` exposes `tree`, the model on screen, with the precedence `treeData` has today. `SPACE_TREE_KEY` provides that model.

## Order

Four tracer bullets, each its own PR on top of #932, each shippable alone. Bullet 1 fixes two of the bugs and needs no new shape, so it goes first. Bullet 3 needs a record to exist before the tree loads, so it follows the new model. Its bug only affects what is shown, so the wait is safe.

| Bullet | Fixes | Removes |
|---|---|---|
| 1. One deleted flag | Struck-through row after a restore | `localStatus`, the summary check in `WikiTree` |
| 2. Normalized model | Recursive lookups on every action and replay | Nested `tree`, `orderIndex`, dead exports |
| 3. One title field | Heading behind the sidebar after a tree reload | Title, route and publish flag on buffers and persisted drafts, `crPage` |
| 4. Readers on selectors | Two full rebuilds per change | `treeAsLegacy`, `staleTreeAsLegacy`, `denormalizeNode`, `adaptReadonlyNode`, `liveTreeData`, the `WikiTree` deep watch, the tree walkers |

## Before bullet 1: Vitest

The unit tests run on `node --test` today. A small PR before bullet 1 moves them to Vitest, so the store tests below can use its fake timers and module mocks.

- Add `vitest` as a dev dependency, at a version that supports Vite 5. `yarn test` runs `vitest run`. CI already calls `yarn test`.
- The 29 test files switch `node:test` imports to `vitest`. `node:assert/strict` keeps working, so assertions do not change.
- Two files use `node:test` mocks (`editorContentSync.test.js`, `paste-data-images.test.js`). `mock.fn` becomes `vi.fn`, `mock.method` becomes `vi.spyOn`, and `mock.timers` becomes `vi.useFakeTimers`.
- Same test count before and after.

Built, on branch `chore/vitest-unit-tests`. Notes:

- Vitest 3 resolves its own Vite 7 by default. The lockfile pins it to the app's Vite 5.4.10, so there is one Vite, one esbuild and one rollup.
- Node's fake `setTimeout` also fakes `clearTimeout`. Vitest fakes only what `toFake` lists, so `clearTimeout` must be listed too, or cleared timers still fire.
- `restoreMocks: true` in the config stands in for `t.mock`, which node restored at the end of each test.
- 186 tests, both runners.

## Bullet 1: One deleted flag

- `applyEntry` stops writing `localStatus`. Delete and restore set only `isDeleted`, over the subtree.
- The log exposes a computed set of the `docKey`s in its entries. `isPending(docKey)` reads it. `applyAcknowledged` and `applyFields` no longer touch status.
- `denormalizeNode` sets `is_deleted` from `isDeleted` alone, and a new `is_pending` from `isPending` in place of `local_status`. It stays until bullet 4.
- `WikiTree.isDeleted` drops the change summary. Both read the head item's `is_deleted`, so `get_cr_tree` already flags every page the summary calls deleted. The summary still drives the added and modified dots.

Tests:

- Playwright, in `pending-delete-visible.spec.ts`, each fails today: delete offline, then restore: the row is not struck through, opens, survives a reload, and both ops reach the server. Delete, let it land, then restore offline: the row is not struck through
- Vitest: replaying delete then restore leaves the subtree not deleted and the page pending

Built, on branch `fix/one-deleted-flag`. Notes:

- `WikiTree` checks the deleted dot before the pending dot. A pending delete shows red, as before, and a pending restore shows the grey syncing dot. The pending dot also comes before the change summary's dots, so a restore waiting offline never shows the summary's stale red dot.
- The unit tests cover the cascade, `is_pending` in the adapter and `isPending` in the log. The bug itself lives in the store's replay, so the two Playwright tests are what fail on the old code.

## Bullet 2: Normalized model

- `createTreeModel` holds `rootKey`, `nodesById` and `childIds`. `applyServerTree` flattens the server tree in one pass and keeps its order.
- `findNode`, `getChildList`, `insertNode`, `removeNodeByKey`, `setSubtreeDeleted` and `placeNode` work on the maps. `getChildList` returns records in order.
- `moveOperations` reads sibling keys from `childIds`, so the reorder op is unchanged.
- `treeAsLegacy` stays, built from the maps, so no reader changes in this PR.
- `orderIndex` and the dead exports go.
- `__draftStore.tree` goes. Specs reach the store through a new `e2e/helpers/draftStore.ts`, which holds the window type and a few reads (`localNode`, `topLevelKeys`, `keyByTitle`). Five specs declare their own store type today.

Tests:

- Vitest, new `treeModel.test.js`: server tree to records and child lists in order. Insert, move inside one parent and across parents, remove. Delete and restore cascade. Replaying a log over a server tree gives the same model as applying it live
- Playwright: the tree, draft and log specs pass unchanged, apart from the helper

Built, on branch `refactor/normalized-tree-model`. Notes:

- `placeNode` moved into the model as `moveNode`, and the model exposes `childKeys(parentKey)`, which is null for an unknown parent. `removeNodeByKey` had no callers, so it went instead of being ported.
- Child lists are replaced, never spliced, so a reader holding an old list never sees it change.
- No unit test for "replay equals live": the model applies both through the same functions, so the test would compare a call with itself. The replay is store code, and `operation-log.spec.ts` covers it.
- Only `operation-log.spec.ts` and `local-first-store.spec.ts` read tree state, so only they use the helper. The other specs read `crName` or `rootKey` or call actions, and stay as they are.
- Vitest: 198 tests. Playwright: 73 tree, draft, log, sidebar and reader tests pass. On the first full run, 5 draft tests failed and then passed alone and in a second full run. That was the first run after switching pulse off, which the e2e notes say can still hit the old setting.

## Bullet 3: One title field

- Page buffers drop `title`, `route` and `isPublished`. So do `emptyPage`, `restoredDraftBuffer`, `seedCreatedPage` and `adoptFetchedPage`.
- `applyFields` and `applyAcknowledged` write the record only.
- A page fetch (`adoptFetchedPage`, `reloadPage`, `revalidateCrPage`, draft restore) writes title, route and publish flag to the record, then replays that page's `update_node` entries, as `applyFetchedPage` does now. If the tree has not loaded, it creates the record with no parent. It is in no child list, so only `findNode` sees it, and loading the tree replaces it.
- Persisted drafts drop `title`. The log already keeps a rename through a reload. A stored title from an older draft is ignored.
- `DraftContributionPanel` drops `crPage` and reads the buffer and the record. `WikiDocumentPanel.displayTitle` reads the record, then the Wiki Document outside a draft.
- `editableTitle` follows the record's title, and resets only when that title changes. Today it resets on every buffer change.
- `recordEditorContent`, `reconcileEditorContent` and `persistEditorDraft` drop their `title` argument.

Tests:

- Playwright, in `operation-log.spec.ts`: rename in tab B, then a retried batch in tab A: the heading, the breadcrumb and the browser tab show B's title. Fails today
- Playwright: typing a title while an autosave lands keeps every character. Passes today, and guards the new reset rule
- Vitest: a page fetch writes the record and keeps a pending rename on top

Built, on branch `fix/one-title-field`. Notes:

- `DraftContributionPanel` keeps `crPage`, but only as the load marker and the content it shows. Title, route and the group flag come from the record. Removing `crPage` outright would rework the loading and "not found" states, which this bullet does not need.
- `WikiDocumentPanel` reads the record only once the draft page has loaded in edit mode. Before that, and in read mode, it shows the published document, as it did.
- A page fetch writes the record only before the tree loads or when the tree has the page, so a page missing from a loaded tree stays missing.
- `restoredDraftBuffer` went: with no title, route or publish flag left, it was an empty buffer with content.
- The store-level "fetch keeps a pending rename" case has no Vitest test, because the store needs Pinia, IndexedDB and the transport. The offline rename test in `operation-log.spec.ts` covers it: it reopens the page after a reload and checks the title. The model's `setFields` has unit tests.
- Vitest: 198 tests. Playwright: 89 tests across draft, log, editor, sidebar, page settings, publish and change request specs.

## Bullet 4: Readers on selectors

- Add the selectors above.
- The stale snapshot and the live tree load into `createTreeModel`. `applyServerTree` also takes the `get_wiki_tree` shape (`name` as `documentName`, `root_key`).
- `space.js` exposes `tree` in place of `treeData`. `SPACE_TREE_KEY` provides it.
- Readers move to selectors: `WikiTree`, `WikiDocumentList`, `useTreeSearch`, `useTreeDialogs`, `SpaceDetails`, `SpaceWelcome`, `useStartEditing`, `SpaceSidebar`, both panels, `WikiEditor`, `WikiPageReader`, `lib/spaceTree.js` and `page-links.js`.
- `WikiTree` builds the nested view as described above.
- Delete `treeAsLegacy`, `staleTreeAsLegacy`, `denormalizeNode`, `adaptReadonlyNode`, `liveTreeData` and the deep watch.
- `ARCHITECTURE.md` gets a short paragraph on the client tree.

Tests:

- Vitest: `trail`, `firstPage` skips deleted pages and empty groups, `nodeByDocumentName`, `linkablePages` skips deleted pages and external links, `pages()` order, the live tree shape
- Playwright: the sidebar, reader, tree search, drill-in, reveal and draft specs pass. They cover the live tree, the stale tree and the draft tree
- Probe: change one field of one row on `perf-big-1000`, before and after. Report the numbers in the PR, no assertion

Built, on branch `refactor/tree-selectors`. Notes:

- Models are `markRaw`, so a store that returns one keeps its refs as refs. The draft store exposes `tree`, `staleTree`, `children` and `isPending`.
- The live tree is a computed that builds a fresh model per `get_wiki_tree` reply. It is only ever replaced whole, so nothing patches it.
- `WikiTree`'s view node is `{ doc_key, record, children }` with `label` as a getter on the record's title. It points at the record and copies nothing, so a rename, a publish toggle or a delete re-renders one row. The view rebuilds only when a child list changes.
- `useTreeDialogs` counts a group's pages with `pages(docKey)`, and `WikiTree` reads a group's children from the model, so neither needs `node.children`.
- `SpaceDetails` watches the page to auto-open and the deleted state of the open page, not the tree object. The model keeps its identity across edits, so watching it would never fire.
- `linkablePages` moved from `page-links.js` into the model, and its test into `treeModel.test.js`.
- Probe, `perf-big-1000` (1,020 records, 70 rows on screen), toggling `isPublished` on one top-level record, median of 41 runs, three runs each:

| | Vue flush | To paint |
|---|---|---|
| Before (`fix/one-title-field`) | 42 to 45 ms | 50 ms |
| After | 1.3 to 1.6 ms | 16.7 ms (one frame) |

- Vitest: 201 tests. Playwright: 296 of 299 passed on the full suite, 1 skipped. `underline.spec.ts` failed once and passed 3 of 3 alone. `command-palette.spec.ts` "sets the theme named in the query" fails on this site's data: leftover spaces named "CCR Preview Highlight" match "light" and rank above "Theme: Light", so Enter opens a space. It does not touch the tree.

## `treeAsLegacy` and the test API

- `treeAsLegacy` stays through bullets 1 to 3 as the one adapter readers use, built from the maps after bullet 2. Bullet 4 deletes it with its last reader. After bullet 4, `treeAsLegacy`, `local_status` and `localStatus` appear nowhere in `frontend/src`, and `is_deleted` appears only where server payloads are read.
- `window.__draftStore` stays the store itself, set in `SpaceDetails`. Its tree surface after bullet 4 is `rootKey`, `findNode`, `children` and `isPending`, beside the actions specs already call. `tree` and `treeAsLegacy` are gone.
- Specs read it only through `e2e/helpers/draftStore.ts`. Bullet 2 writes the helper over `findNode` and `treeAsLegacy`, and bullet 4 switches its body to selectors, so the specs change once.

## Risks

- **Rebuilding the nested view.** A rename or a move still rebuilds the frappe-ui `Tree` input. It holds three fields per row, against two full copies today. If the probe shows it, cache view nodes per record.
- **The live tree changes too.** Read-only spaces, git-synced spaces and reader breadcrumbs go through the new model in bullet 4. The existing sidebar and reader specs cover them.
- **A record created before the tree loads.** `restorePersistedDrafts` runs after the tree load, which replaces it, so a page missing from the tree is still treated as an orphan.
- **Title input reset.** If `editableTitle` followed the wrong source, typing in the title could be undone. Bullet 3's Playwright test covers it.
- **Older tabs during a deploy.** No server change. A draft written by the new build has no title, and an old build then shows the server title, as it does today when the server answers.

## Not in scope

- The change summary. It is the server's diff against the base, and still drives the added and modified dots and the change list
- Page content layers (`content`, `localContent`, `serverContent`, `sentContent` and the editor's own copy). That is R4
- The unused `label` that `get_cr_tree` sends. API callers may read it
- Fractional ordering (3.4) and socket invalidation (3.7)
