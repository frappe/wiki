# Architecture Review: What We Would Do Differently

This review covers the editing architecture (change requests, revisions, merge), the client-side editing state, and data loading and caching. It lists what we would change if we started from zero, ranked by impact, plus bugs to fix now.

The core design is sound and worth keeping: stable `doc_key` identity, hash-deduplicated content blobs, copy-on-write draft heads (O(1) change request creation), atomic batched operations, a real 3-way merge, and stale-while-revalidate in the editor.

Most of the cost and complexity comes from five early choices:

1. Server-assigned page IDs.
2. Markdown as the editing format.
3. Diffs recomputed on every read instead of kept on write.
4. A full space snapshot written on every merge.
5. The same state copied across several stores.

## What we would do differently

### Editing model (client and server)

1. **Client-generated permanent IDs instead of `tmp_*` keys.**
   - Today: a new page gets a temp key that the server later swaps for the real key.
   - Cost: `tempKeyResolver`, `promoteKey`, key rewrites across the queue, move scheduler and save serializer, `findNode(realKey) || findNode(docKey)` lookups, and two editor panels (`WikiDocumentPanel`, `DraftContributionPanel`). Promotion calls `router.replace`, which remounts the editor and loses the cursor and undo history. Temp creates are lost on reload.
   - Instead: the client generates a UUID or ULID `doc_key` and the server accepts it.

2. **A durable operation log with operation IDs.**
   - Today: the operation queue is in memory only, so unsynced renames, moves, deletes and creates are lost on reload. Each action type rolls back differently (create keeps the node, update is not reverted, delete is reverted, move is kept). A retry after a lost response gets a version conflict.
   - Instead: one append-only log in IndexedDB (`{opId, type, payload}`), written before the UI updates. One flusher coalesces, batches and retries, and the server deduplicates by `opId`. The UI shows the server snapshot with pending operations replayed on top, so rollback means dropping an operation.

3. **Versions per page instead of per change request.**
   - Today: one `operation_version` per change request, behind a change request row lock. Two tabs editing different pages get a false conflict. The conflict is detected only once: the client adopts the server version (`frontend/src/stores/draftWorkspace/syncTransport.js:113`), and its next save silently overwrites the other tab's change.
   - Instead: each `update_content` carries a base content hash or item version for that page, and the server locks only that item row. Add BroadcastChannel or Web Locks so one tab writes per change request.

4. **ProseMirror JSON as the editing format, with markdown derived on the server.**
   - Today: markdown everywhere. This causes serialize, parse, serialize canonicalization, phantom "unsaved" states and self-heal code. `frontend/src/components/WikiEditor.vue:779` passes a `content` ref to `useEditor`, so frappe-ui serializes the whole document to markdown twice per keystroke and nothing uses the result.
   - Instead: store the editor JSON (or Yjs, if real-time collaboration is planned; Tiptap and frappe-ui already support a collaboration mode). Generate markdown on the server for git sync, `llms.txt` and `.md`. "Dirty" becomes "document changed since last save", with no string comparison.
   - Quick win now: stop passing the `content` ref and seed the editor once.

5. **One normalized client store.**
   - Today: the tree exists in 5 copies (including a deep-watched `treeAsLegacy` and the `WikiTree` copy), change state in 3, the page title in 5, and page content in 7 layers. "Deleted" is tracked by 3 separate signals.
   - Instead: `nodesById` plus `childIds` per parent, with derived selectors. One title field and one deleted flag.

### Backend data model

6. **Keep the change summary on write instead of recomputing it on read.**
   - Today: `get_cr_tree` and `diff_change_request` each load about 3N rows and recompute the full diff (N = pages in the space). This runs twice in parallel on load and again 1 s after every autosave.
   - Instead: the overlay rows already are the change set. Store a `change_type` on each overlay item so the summary is one query over the changes only.

7. **Delta revisions instead of full snapshots.**
   - Today: every merge, desk edit and git sync writes one revision item per page in the space (git sync writes two). Nothing prunes them; docs.frappe.io has over 1M revision item rows.
   - Instead: per-revision change sets with occasional checkpoints, and garbage collection for unreferenced blobs and items.

8. **Fractional ordering keys, and drop NestedSet.** The two halves apply to different layers.
   - **Fractional keys, mainly before merge (Wiki Revision Item `order_index`).** Today a reorder inside a change request renumbers every sibling. Each one is copied into the draft overlay (about 5 queries each), shows as "reordered" in the diff, and causes false tree conflicts at merge. With fractional keys a move changes one row. The live `Wiki Document.sort_order` could use the same scheme for consistency, but it costs much less there.
   - **Drop NestedSet, on the final `Wiki Document` doctype.** `Wiki Document` is a NestedSet tree (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.py:133`). `lft`/`rgt` values are global across the table, so every insert or move during a merge shifts and row-locks rows in all spaces, and the live reorder calls `rebuild_wiki_tree()` over the whole table. Sibling order does not come from `lft`; readers sort by `sort_order` in Python (`wiki_document.py:893`). `lft`/`rgt` only serve `get_ancestors()` and `get_descendants_of()`, which can use `parent_wiki_document` with a recursive CTE or the cached space tree.
   - Trade-off: removing `is_tree` is a schema change. It needs a patch, loses the Desk tree view, and needs a check that nothing else depends on `lft`/`rgt`. A cheaper first step is to keep NestedSet, skip `update_nsm` per document during a merge, and recompute the nested set once per space at the end. Frappe's `rebuild_tree` rebuilds the whole table, so this needs a space-scoped rebuild.
   - Recommendation: do fractional keys in revision items first. For the live tree, start with the skip-and-rebuild-once step, and drop NestedSet only if merge times on large sites justify it.

9. **Serialized, idempotent merges.**
   - Today: nothing locks `main_revision`, so two concurrent merges can lose one update. The conflict path commits partway through, and repeated merge clicks create duplicate conflict rows.
   - Instead: `FOR UPDATE` on Wiki Space, compare-and-swap of `main_revision`, and upserted conflict rows.

### Loading and caching

10. **Render read-only SPA pages as HTML and load the editor only on Edit.**
    - Today: every SPA page view loads the 1.1 MB gzip editor chunk and parses markdown in the browser. About 2.7 MB of source in that chunk is pdf.js, imported statically in `PdfBlockView.vue:14` and `PdfViewerModal.vue:12`.
    - Instead: lazy-load the PDF views, and show the server-rendered HTML that is already cached until the user clicks Edit.

11. **Cacheable public pages and a slim sidebar tree.**
    - Today: responses send `no-store`, and every GET (guests included) generates a CSRF token and runs `db.commit()`. The sidebar tree is drawn twice (desktop and mobile) at about 2 KB per row with Alpine bindings. On a 120-page site the article starts at byte 486K of 526K; a 1,000-page space would reach about 4 MB per page.
    - Instead: draw the tree once with plain `<a>` rows and one delegated listener. For guests, cache full HTML keyed by route and tree version and send `s-maxage` with an ETag so a CDN can serve it. Make `get_page_data` a cacheable GET.

12. **Versioned tree endpoints and per-space invalidation.**
    - Today: any document save in any space clears the tree cache for all spaces. `get_wiki_tree` for read-only users is not cached.
    - Instead: cache by space and version, return 304 when unchanged, and drop redundant fields from the payload (about 360 KB per 1,000 pages).

13. **One bootstrap call and one query cache.**
    - Today: opening a space takes 4 serial requests and creates a draft change request (a write on a read path). User data and translations load after mount, and translations are not reactive. There are three hand-written stale-while-revalidate implementations, and the socket is not used for invalidation.
    - Instead: user, roles and translations in the boot data, one `get_space_bootstrap` call, draft creation on the first edit, one query-keyed SWR cache invalidated over the socket, and hover prefetch in the SPA tree.

14. **Smaller items.**
    - Autosave waits for 10 s of idle, so continuous typing never saves. Use 2 to 3 s with a maximum wait.
    - Each save makes 3 requests. Return what the panel needs in the save response.
    - SPA search uses `route LIKE '%q%'`, which does not match titles or content. Use the SQLite search index.
    - Delete the dead `useBatchOperations` legacy path (about 150 lines).

## Bugs to fix now

| Severity | Issue | Location |
|---|---|---|
| Security | `diff_change_request` has no permission check; any logged-in user can read draft content | `wiki_change_request.py:1261` |
| Security | `list_change_requests` uses `get_all`, which ignores permissions | `wiki_change_request.py:604` |
| Data loss | A version conflict is caught once, then the next save overwrites the other tab | `syncTransport.js:113` |
| Correctness | `retry_merge_after_resolution` has no status check; a Draft or Rejected change request can merge | `wiki_change_request.py:1622` |
| Correctness | Concurrent merges can lose a `main_revision` update | merge path |
| Performance | Two hidden full serializations per keystroke | `WikiEditor.vue:779` |
| Performance | pdf.js loads with every editor | `PdfBlockView.vue:14`, `PdfViewerModal.vue:12` |

## Suggested order

1. **Now:** the bugs above, as small separate PRs with regression tests.
2. **Next:** read mode HTML in the SPA, then public page caching and the slim tree. These give the largest visible gain without data model changes.
3. **Then:** client UUIDs, the durable operation log and versions per page, together. This removes most of the client complexity.
4. **Later:** the change summary kept on write, delta revisions and fractional ordering. Then decide on Yjs documents, which only make sense if real-time collaboration is on the roadmap.

`ARCHITECTURE.md` is out of date: it still describes the removed Wiki Contribution doctypes.
