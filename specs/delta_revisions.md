# Delta Revisions

Roadmap 3.6 (R7), without garbage collection.

## Why

A merge costs time and storage in proportion to the size of the space, not the size of the change.

- `create_merge_revision` writes one Wiki Revision Item for every page in the space, with one `insert()` each. Each insert runs 3 queries: the INSERT and a link check on `revision` and `content_blob`. On a 1,000-page space, a one-page edit writes 1,000 rows and runs about 3,000 queries (4 to 5 s).
- Desk edits and git sync write full snapshots the same way.
- docs.frappe.io has over 1M revision item rows. wiki.localhost has 36k.

With n pages in the space and k pages changed: a merge runs about 3n + k × (cost of one save) queries and stores n rows. It should store k rows.

## Design

### A revision with a parent stores what changed

A main revision that has a parent (merges, Desk snapshots, git sync) is an overlay: `is_overlay = 1`, and its items are the pages that differ from `parent_revision`.

- A changed or added page is a row with its new fields.
- A removed page is a row with `is_deleted = 1` (a tombstone).
- A merge's `parent_revision` is the space's `main_revision` at merge time, not the change request's `base_revision`. The change request keeps `base_revision`.

### Checkpoints

A chain of overlays ends at a full revision. A new main revision is written in full when the overlay rows already in its chain, plus its own delta, reach the number of pages in the space. Then:

- Storage per merge is k rows, amortized. A one-page edit on a 1,000-page space writes about 1 row, and 1 full checkpoint per 1,000 merges.
- A read loads at most about 2n rows, as many as two full snapshots.

A revision with no parent (the first snapshot, older revisions) stays full. Existing data needs no migration: every existing main revision is full, so it is a valid checkpoint.

### Reading a revision

`get_revision_item_map(revision)` returns the tree the revision stands for, whatever its storage:

1. One recursive CTE walks `parent_revision` from the revision while the revision is an overlay, down to the first full one.
2. One `get_all` loads the items of every revision in that chain.
3. Items are laid on top of each other, oldest first. A tombstone in a committed revision removes the page. A tombstone in a working revision (a change request head) stays, so the change request still shows the page as deleted.

`get_effective_revision_item_map` goes away: every revision now resolves the same way. `get_revision_item(revision, doc_key)` does the same for one page. It replaces the three copies of "look in the overlay, then in the parent".

### Writing a revision

- `create_revision(wiki_space, items, parent_revision, **fields)` creates the Wiki Revision and its items, as a delta or a checkpoint. Merges, Desk snapshots and git sync call it.
- Items go in with `frappe.db.bulk_insert`: one INSERT per 1,000 rows, no link checks. The values come from our own maps, so the checks add nothing.
- `get_or_create_content_blobs(contents)` looks up all blobs in one query and bulk inserts the missing ones, for the live-tree snapshot and git sync.
- `clone_revision` has no callers and is removed.

### History

- The main chain is every revision with `is_working = 0`. Overlays are part of it now.
- Page history: a delta with no row for the page left it as it was, so it is skipped.
- `get_revision_changes` refuses working revisions only. All overlays that are not working are main revisions.

## Not in scope

- Garbage collection of old full snapshots and unreferenced blobs. Existing rows stay.
- A change summary kept on write (3.3). Space history still diffs two item maps per version.

## Tracer bullets

1. Benchmark on `perf-big-1000` before any change: a merge adding 1,000 pages, then 20 one-page edits, and reads.
2. Bulk insert for every full snapshot. Benchmark.
3. Chain-aware reads, then merges as deltas with checkpoints. Benchmark.
4. Desk snapshots and git sync as deltas. History reads the chain.
5. Tests, docs (`ARCHITECTURE.md`, `edit_flow.md`). No whitelisted method changes, so the agent skill stays as it is.

## Progress

### Benchmark (2026-10-28)

`perf-big-1000` (1,021 pages) on wiki.localhost. Each scenario runs in its own transaction and is rolled back. The script times `merge_change_request` only and counts `frappe.db.sql` calls.

| Scenario | Before | Bulk insert | Delta revisions |
|---|---|---|---|
| Edit 1 page, median of 5 | 4.37 s, 3,111 queries | 0.29 s, 50 queries | 0.11 s, 53 queries |
| Item rows per one-page merge | 1,021 | 1,021 | 1 |
| 20 one-page merges, item rows | 20,420 | 20,420 | 20 |
| Add 1,000 pages | 42.5 s, 21,125 queries, 2,021 rows | 31.5 s, 15,158 queries | 33.1 s, 15,066 queries, 1,000 rows |
| Read the main item map | 10.9 ms, 2 queries | 13.8 ms | 16.8 ms, 3 queries |
| `get_cr_tree` | 42.2 ms | 59.9 ms | 55.7 ms |
| `get_page_history` | 2.1 ms | 3.4 ms | 2.1 ms |
| `get_space_history`, 21 versions | 431 ms, 84 queries | 693 ms | 562 ms, 125 queries |

- Reads run in the same transaction as the 20 merges before them, so they are noisy: `get_space_history` moved by 260 ms between two runs of code that reads the same way.
- Space history now resolves a chain for each version: 3 queries instead of 2. A change summary kept on write (3.3) would make it one query.
- Adding 1,000 pages still takes 33 s. Writing the revision is 0.5 s of it. The rest is 1,000 Wiki Document inserts and their hooks, profiled: `index_doc` 9 s (inline search index), `stamp_wiki_space` 5.5 s, `clear_wiki_tree_cache` 4.8 s (once per page), `_get_wiki_space_for_document` 3.7 s, stale website cache 3.6 s, route checks 1.9 s. That cost grows with pages changed, not space size, so it is a separate fix.

### Done

- [x] Spec
- [x] Benchmark before
- [x] Bulk insert for every full snapshot (`insert_revision_items`, `get_or_create_content_blobs`). `clone_revision` removed.
- [x] Chain-aware reads: `_revision_chain` (recursive CTE), `get_revision_item_map`, `get_revision_item`. `get_effective_revision_item_map` removed.
- [x] Merges, Desk snapshots and git sync written by `create_revision` as deltas, with checkpoints
- [x] History reads overlays
- [x] Tests: `test_wiki_revision.py` (5), all fail with the change reverted. `test_merge_reconciles_stale_sort_order` reads the main revision through its chain. The history test for page versions fails without the overlay skip.
- [x] Suites: change request (142), history, git sync, GitHub, document, API, permissions, telemetry, space: all pass
- [x] E2E on a worktree server: version history, change request flow and review, space change requests, ordering, pending delete, edit flow, git sync read-only, draft version conflict. 52 of 56 pass with 2 workers. The 4 failures pass alone, and the old code fails 6 of the same set with 2 workers.
- [x] Docs: `ARCHITECTURE.md`, `edit_flow.md`

Found on the way:
- One e2e space came out of a merge with a broken nested set (the root's `rgt` below its child's). This change does not write `lft` or `rgt`. It looks like a race between concurrent nested set writers in different spaces. Not fixed here.
