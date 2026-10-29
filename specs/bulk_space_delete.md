# Bulk Space Delete

Date: 2026-10-29
Status: **Phases 1 and 2 done. Phase 3 not needed.**
Depends on: #903, merged (`lock_wiki_tree`, deferred nested set on space delete).

## Goal

Delete a space with 3,000 pages in one request, in seconds, without flooding
the job queue or locking the page tree for minutes.

## Problem

Space Settings, General, Delete Space calls `space.delete.submit()`. That
runs `frappe.delete_doc("Wiki Space")`, and `Wiki Space.on_trash` calls
`delete_linked_content()`. It deletes every linked row with its own
`frappe.delete_doc` call: pages, revision items, revisions, git sync logs
and change requests.

Each `delete_doc` call does all of this:

- Link check and dynamic link check.
- A `Deleted Document` backup row.
- A "Deleted" `Comment` row (`insert_feed`).
- `on_trash` hooks. For a page, that's the tree cache, content cache,
  website cache, OG cards and search index.
- One `delete_dynamic_links` background job, enqueued after commit.

Revision items dominate the count. A space keeps one item per page per
revision.

Measured on wikidemo.localhost with the deadlock fix in place:

| Space | `delete_doc` calls | Time |
|---|---|---|
| 1,000 pages, 5 revisions | 7,014 | 92 s |

- The SQL deletes took 2.5 s of the 92 s. `insert_feed` alone took 38 s.
- The 7,014 queued jobs filled the queue. The next delete failed in
  `_check_queue_size`. The queue is shared by every site on the bench.
- A 3,000-page space with 20 revisions is about 60k calls. Expect 10+
  minutes in one transaction. That's past the web timeout, and a rollback
  takes as long again.
- With `lock_wiki_tree`, every structural merge on the site waits for the
  whole delete.
- wiki.localhost already holds 225,934 `Deleted Document` rows for wiki
  DocTypes.

## What links to a space's rows

From `tabDocField`. `force=True` skips Frappe's link check today, so some of
these are left orphaned now.

| Row | Linked from |
|---|---|
| Wiki Space | Wiki Document, Wiki Revision, Wiki Change Request, Wiki Git Sync Log (`wiki_space`); Wiki App Switcher List Table (child of Wiki Settings) |
| Wiki Document | Wiki Feedback (`wiki_document`); Wiki Space (`root_group`); itself (`parent_wiki_document`, `old_parent`) |
| Wiki Revision | Wiki Revision Item (`revision`); Wiki Change Request (`base_revision`, `head_revision`, `merge_revision`); Wiki Space (`main_revision`); itself (`parent_revision`, `checkpoint_revision`) |
| Wiki Change Request | Wiki Merge Conflict, Wiki Revision (`change_request`) |
| Wiki Content Blob | Wiki Revision Item (`content_blob`). Blobs are content-addressed and shared across spaces. |

Framework rows keyed by `(doctype, name)`: Version, Comment, ToDo, DocShare,
View Log, Document Follow, Notification Log, Communication Link, Activity Log.

Files: git sync attaches images to the Wiki Space. Editor uploads are not
attached to pages.

## Decisions

1. **Bulk SQL for internal rows.** Delete pages, revision items, revisions,
   merge conflicts, change requests, git sync logs and feedback with one
   `frappe.qb` delete per DocType (`delete_rows` in `wiki_space.py`). These
   rows are internal. Nobody restores a revision item from Deleted
   Documents.
2. **The space itself still goes through `delete_doc`.** It keeps its
   permission check, its `Deleted Document` backup, its child tables, its
   attached files and its `on_trash` crawler cache clear.
3. **No per-row backup, feed comment or job.** That's the cost we are
   removing. Restoring a space from thousands of `Deleted Document` rows
   isn't possible today anyway.
4. **Clear framework references in bulk.** Run the `delete_dynamic_links`
   delete targets once per DocType with `reference_name in (subquery)`, so
   no orphaned Version, Comment or ToDo rows stay behind. A subquery, not a
   list of names: binding 63k revision item names to ten tables took 12 s
   in Python alone. Communication and Activity Log are skipped. Frappe only
   unlinks those, and no wiki row is referenced from either.
5. **Page side effects run once per space, not once per page.**
   - Tree cache: one `clear_wiki_tree_cache(space)`.
   - Content cache: one `HDEL` per page name, now and after commit. v15's
     `hdel` takes a single field.
   - Website cache: one `clear_website_cache()`, now and after commit.
   - OG cards: one after-commit callback that loops over the doc keys.
   - Search index: one after-commit delete of every page `doc_id` from
     `search_fts` and `search_index_queue`.
6. **Keep `lock_wiki_tree`.** The tree lock is now held for seconds, not
   minutes. Pages no longer go through `delete_doc`, so the nested set is
   never touched and the deleted range stays as a gap.
7. **Content blobs stay.** Other spaces and revisions share them. Collecting
   orphaned blobs is a separate job.
8. **Synchronous first, enqueue only if needed.** If a 3,000-page, 20-revision
   delete still takes more than 10 s after Phase 1, Phase 3 moves it to a
   background job. A background job alone doesn't fix this: it would still
   run one transaction for minutes, flood the queue and hold the tree lock.

## Phases

### Phase 1: tracer bullet (bulk delete)

UI button, then `delete_doc("Wiki Space")`, then bulk `delete_linked_content`,
then caches and search index.

- Rewrite `WikiSpace.delete_linked_content` around per-DocType
  `frappe.db.delete`. Collect page names, doc keys and routes first, from
  the root group's `lft`/`rgt` range plus `wiki_space = name`.
- Delete in an order that never leaves a dangling `root_group` or
  `main_revision` mid-transaction: merge conflicts, change requests,
  revision items, revisions, feedback, pages, git sync logs, then the
  framework references.
- Run the side effects from decision 5.
- Unit tests in `test_wiki_space.py`:
  - Every listed row for the space is gone. Another space's rows and
    numbering are untouched.
  - Deleting creates no `Deleted Document` or "Deleted" `Comment` rows for
    pages or revision items, and queues no jobs.
  - Search index rows for the pages are gone after commit.
  - Feedback and merge conflicts for the space are gone.
- Benchmark with `/tmp/merge_deadlock/delete_bench.py`: 1,000 pages and 5
  revisions, then 3,000 pages and 20 revisions. Record both numbers here.
- Check each test fails with the old `delete_linked_content` swapped back in.

### Phase 2: e2e

- Extend `e2e/tests/space-delete.spec.ts`: delete a space with pages, a
  merged change request and a page that has feedback. Then check the space
  is gone from the library, its URLs return 404, and its pages don't show
  in search.
- Search is covered by the unit test only. Pages seeded during an e2e run
  are not in the index yet (the queue drains every 5 minutes), so an e2e
  search check would pass even without the fix.

### Phase 3: background delete (only if Phase 1 misses the 10 s target)

- Mark the space `deleting` and hide it from the library and the reader.
- Enqueue the delete on the `long` queue with `deduplicate` on the space name.
- Show "Deleting…" in Space Settings until the job finishes.

## Out of scope

- Cleaning up existing bloat: 225k `Deleted Document` rows and the matching
  "Deleted" comments. That's a separate patch.
- Garbage collection of orphaned content blobs.
- Desk deletes of single pages. They still go through `delete_doc` and
  Frappe's nested set.

## Progress log

- 2026-10-29: Spec written. Baseline measured: 1,000 pages and 5
  revisions take 92 s and queue 7,014 jobs.
- 2026-10-29: Phase 1 done. `delete_rows` deletes each DocType and its
  framework references in one statement each. Measured on
  wikidemo.localhost (SQLite), one queued job each (the space's own):

  | Space | Before | After |
  |---|---|---|
  | 1,000 pages, 6 revisions, 6k items | 92 s | 0.5 s |
  | 3,000 pages, 21 revisions, 63k items | not run | 2.0 s |

  A first cut passed revision item names as `IN` lists and took 14.0 s
  for the larger space. 12 s of that was Python binding 730k parameters,
  so the names now stay in subqueries.
- 2026-10-29: On wiki.localhost (MariaDB), 28 leftover repro spaces of up
  to 3,000 pages each deleted through `DELETE /api/resource/Wiki Space` in
  0.6 to 2.6 s per request. The old code had timed out on them.
- 2026-10-29: Each unit test fails with the old `delete_linked_content`
  swapped back in.
- 2026-10-29: Found while testing: concurrent structural merges still
  mis-numbered the tree after the deadlock fix (100 pages outside their
  parent in one 18-merge run). A merge that waits on `lock_wiki_tree` keeps
  its older snapshot, so `rebuild_space_nested_set` read pre-shift
  `lft`/`rgt`. Fixed with a locking read. 0 bad pages in 27 concurrent
  merges after the fix. Regression test:
  `test_merge_that_waited_on_the_tree_lock_renumbers_from_current_rows`.
  Fixed separately in #904.
- 2026-10-29: Phase 2 e2e spec written. Phase 3 not needed.
