# Edit Rail: Stale While Revalidate

Date: 2026-10-08
Status: **Phases 1, 2 and 5 done** (2026-10-08). Phases 3 and 4 open. Builds on #843 (`perf/edit-opens-editor-first`).

## Goal

After an author clicks Edit, the editor rail (the space tree on the left) appears last. Show the tree the author saw last time straight away, then swap in the fresh one when it arrives.

## Observation

The reader rail and the editor rail hold the same data. On Perf Big 1000 (1,020 pages) the two trees match row for row, except for rows the author changed in their own draft. So the tree from the author's last visit is almost always right.

## Baseline

`perf-big-1000`, click Edit on `/perf-big-1000/group-00/group-00-page-00`, time to `.ProseMirror[contenteditable=true]` (editor) and to 10+ folder rows in `.wiki-tree` (rail). Median of 5 after one warm-up. #843 frontend, with commit `9410f526` on the backend.

| | editor visible | rail painted |
| --- | --- | --- |
| local | 344 ms | 472 ms |
| 100 ms latency | 757 ms | 869 ms |

Request chain at 100 ms latency (ms from click):

```
  0 → 269   page navigation and app load
269 → 391   get_user_info
359 → 464   space doc, page doc, get_space_capabilities
474 → 577   get_or_create_draft_change_request
583 → 770   get_cr_tree   (diff_change_request runs alongside, same diff)
770 → 869   parse 360 KB, build and render 1,000 rows
```

The rail waits behind four requests in a row. Each pays the full latency.

## Design

1. **Snapshot.** Each time a server tree is applied, save it to IndexedDB under `tree:<user>:<space>`, in the existing `wiki-drafts` store (`draftPersistence.js`). Draft keys use the `cr:` prefix, so the two never collide.
2. **Paint.** At the start of `hydrate()`, read the snapshot and apply it to a second `createTreeModel()` instance, setting `hasStaleTree`. This does not wait for the CR request, and the CR request does not wait for it.
3. **Keep stale data out of draft logic.** The snapshot lives in its own tree model. `treeModel`, `findNode`, `hasLoadedTree`, the save hold and the submit/merge gate never see it.
4. **Rail.** `spaceStore.treeData` returns the fresh tree, else the stale one. While the tree is stale the rail renders as `readonly`, which turns off drag, row menus and New page.
5. **Swap.** When the fresh tree lands, drop the snapshot model and clear `hasStaleTree`. Expanded state lives in its own model, so nothing collapses.

Hydrate only starts once the space doc and capabilities say the user may contribute (`space.js` watcher). So a user who lost access never sees a stale tree.

## Phases

1. **Prototype.** Steps 1 to 5. Measure against the baseline. Done.
2. **Logout.** Clear `tree:` keys on logout, so a second user on the same browser never sees another user's titles. Done: `clearTreeSnapshots()` runs before the redirect to `/login`, so the page unload cannot cut it off. Logging out of the public site goes through Frappe's own `/logout` and skips this, but snapshots are keyed by user, so the next user never reads them.
3. **Change dots.** Save the change summary with the snapshot, so dots show while stale.
4. **Drop the duplicate diff.** `hydrate()` calls `diff_change_request(summary)` next to `get_cr_tree`, which already computes the same diff for its dots.
5. **Tests.** Done: `e2e/tests/edit-rail-stale-tree.spec.ts`. One test adds a row only to the snapshot, holds `get_cr_tree` and reloads: the row shows with New page off, then disappears and New page returns when the tree is released. The other logs out from the command palette and expects no `tree:` keys. Each fails with its part of the fix reverted.

## Risks

- **Rows deleted by someone else** show until the fresh tree lands. Clicking one opens a page that fails to load for one round trip.
- **Full re-render on swap.** Every row re-renders when the fresh tree replaces the snapshot (about 50 to 100 ms on 1,000 rows). Fine for now; patch only changed rows if it shows up in a measurement.
- **First visit to a space** has no snapshot and behaves as today.
- **Size.** About 360 KB per 1,000 pages per space in IndexedDB.

## Results

Same setup as the baseline, median of 9 runs each, built back to back:

| | rail before | rail after | editor before | editor after |
| --- | --- | --- | --- | --- |
| local | 522 ms | **303 ms** | 405 ms | 415 ms |
| 100 ms latency | 835 ms | **512 ms** | 740 ms | 757 ms |

The rail paints about 40% sooner. Editor times overlap run for run, so the change is noise.

With `get_cr_tree` held for 3 s: the stale rail shows the last tree with its change dots, no New page, no drag handles, and Merge and Submit disabled. When the fresh tree lands, New page and drag come back and no row moves.

Found while building:

- **Reactive proxy.** The API response is a Vue reactive proxy, which IndexedDB cannot clone (`DataCloneError`). Save `toRaw(serverTree)`. Vue creates nested proxies lazily, so the raw object is plain all the way down.
- **Row height.** Read-only rows were 32 px and editable rows 40 px, because the row action button sets the height. The swap shifted every row. Rows now have `min-h-10`, so read-only and editable rows match, including in git-synced spaces.

E2E: `edit-rail-stale-tree`, `edit-opens-before-tree`, `editor-tree-reveal`, `tree-search` and `local-first-store` pass (29 tests).
