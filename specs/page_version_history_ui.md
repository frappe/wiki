# Page Version History UI

Date: 2026-07-07
Status: **In progress.** Addresses issue [#622](https://github.com/frappe/wiki/issues/622) ("UI for Version History"). Backend revision *data model* already exists (v3); this spec adds the **read endpoints** and the **history browser UI** for a single page.

### Progress log
- 2026-07-07 — Spec committed. Starting tracer-bullet slice 1 (list end-to-end).

## Goal

Let an **editor** (contributor) open a wiki page and browse its version history: a chronological list of every published revision that changed the page, and a content diff between a selected revision and its predecessor. **Read-only browse** — no restore/revert in this iteration. Scope is **per-page** (one `Wiki Document` / `doc_key`), not a space-wide timeline.

This is an **editor-facing** tool, not a reader feature: it is gated on contribute capability and surfaced only in the editing context, not on the public rendered page. Plain readers never see it.

Decisions (locked with maintainer):
- Audience: **editors / contributors** — gated on `can_contribute_to_space`, **not** `can_read_space`. (Tighten to `can_write_space` if history should be limited to direct writers rather than CR proposers.)
- Granularity: **page history only** (deferred: space-wide timeline).
- Capability: **read-only browse** (deferred: restore-to-revision, which would open a seeded Change Request).
- Placement: **dedicated nested route** `/spaces/:spaceId/page/:pageId/history`, reached only from an editor-context entry point.

## Current State

### What exists (the "backend is there" from the issue)

The v3 revision engine (`wiki/frappe_wiki/`) is a git-like content-addressed model:

- **`Wiki Revision`** — an immutable snapshot of a whole space tree. Fields: `wiki_space`, `parent_revision`, `change_request`, `message`, `is_merge`, `is_working`, `is_overlay`, `created_by`, `created_at`, `tree_hash`, `content_hash`, `doc_count`.
- **`Wiki Revision Item`** — one row per page inside a revision. Keyed by stable `doc_key`. Holds metadata (`title`, `slug`, `route`, `is_group`, `is_published`, `is_external_link`, `external_url`, `parent_key`, `order_index`, `is_deleted`) and a `content_blob` link.
- **`Wiki Content Blob`** — deduplicated content, addressed by SHA-256 `hash`. Identical content across revisions ⇒ same blob ⇒ same hash.
- **`Wiki Space.main_revision`** — pointer to the current published head revision.

Published history of a space advances by appending non-working, non-overlay `Wiki Revision`s and moving `main_revision`:
- Bootstrap: `_bootstrap_main_revision` → `create_revision_from_live_tree(...)` (`is_working=0`, `is_overlay=0`).
- CR merge: `create_merge_revision` (`is_merge=1`, `is_working=0`, `is_overlay=0`) then `main_revision = merge_revision`.
- Git sync / direct advance: `create_revision_from_live_tree` (`wiki/wiki/git_sync.py`, `wiki/api/wiki_space.py`).
- CR working heads are `is_overlay=1` (excluded from published history).

### What's missing

- **No read endpoint** to list a page's history or diff two revisions. `wiki_change_request.diff_change_request` diffs a CR's `base`↔`head` only — coupled to a CR, not to two arbitrary revisions. The only `get_revisions` in the repo (`wiki/wiki/doctype/wiki_page_revision/`) is the **legacy v2** model — unrelated.
- **No UI.** Frontend (`frontend/src`) has `DiffViewer.vue` (wraps `@pierre/diffs`) and the CR review flow, but nothing surfacing per-page history.

## Key design decision: how to reconstruct one page's history

The `parent_revision` pointer is **not** a clean linked list. In a three-way merge, `create_merge_revision` sets `parent_revision = cr.base_revision` (the CR's base, i.e. old main), **not** the current main — so walking `parent_revision` from `main_revision` can skip concurrently-merged revisions. Do **not** reconstruct history by walking parents.

**Robust approach — query the published snapshot set by time:**

```
revisions = Wiki Revision WHERE wiki_space = X AND is_working = 0 AND is_overlay = 0
            ORDER BY created_at ASC
```

This is exactly the set of published states (bootstrap + git-sync advances + CR merges). CR working overlays are excluded (`is_overlay=1`). No non-test caller creates stray non-working/non-overlay revisions (`clone_revision` has no production callers; `create_revision_from_live_tree` is only ever used to seed/advance main). A rejected CR never reaches `create_merge_revision`, so there are no orphan merge snapshots.

For the target `doc_key`, walk that time-ordered list, comparing each revision's item against the previous one that contained the page. Diffing consecutive materialized states is correct **even across the merge-parent quirk**: a three-way merge builds its item set starting from current main, so `M(prev) → M(next)` shows exactly what that merge changed for the page — no more, no less.

## Backend

New module: `wiki/frappe_wiki/doctype/wiki_revision/history.py`. Reuse helpers already in `wiki_revision.py`: `get_revision_item_map`, `get_contents_for_items` (in `wiki_change_request.py` — move/import).

### Indexes (performance)

The history query `WHERE wiki_space = X AND is_working = 0 AND is_overlay = 0 ORDER BY created_at` currently has no supporting index (checked the `Wiki Revision` JSON — no `search_index`/composite). Without one it's a full-table scan + filesort that degrades as revisions accumulate. Add composite indexes via module-level `on_doctype_update()` (Frappe runs it on every `bench migrate`; `frappe.db.add_index` is idempotent — composite indexes **cannot** be declared through DocType JSON field flags).

- **`Wiki Revision`** — `(wiki_space, is_working, is_overlay, created_at)`. `wiki_space` + the two booleans are equality predicates (leftmost), `created_at` serves both the range and the `ORDER BY` — the whole WHERE+sort is index-covered.
  ```python
  # wiki/frappe_wiki/doctype/wiki_revision/wiki_revision.py
  def on_doctype_update():
      frappe.db.add_index(
          "Wiki Revision",
          ["wiki_space", "is_working", "is_overlay", "created_at"],
          index_name="wiki_space_published_history",
      )
  ```
  (Leaner alternative if index width is a concern: `(wiki_space, created_at)` — the booleans become cheap residual filters on the already-narrow per-space set.)
- **`Wiki Revision Item`** — index on `doc_key` so the per-page batch load (`WHERE revision IN (...) AND doc_key = X`) narrows to one page's items directly instead of scanning. `doc_key` is highly selective; set `"search_index": 1` on the field in the DocType JSON (single-column — JSON flag is fine). Optionally composite `(doc_key, revision)` via `on_doctype_update` if the `IN (...)` set is large for old spaces.

Confirm with `EXPLAIN` on a seeded space that the history query uses `wiki_space_published_history` (no `Using filesort`).

### Endpoint 1 — `get_page_history(page: str)`

`@frappe.whitelist()`. `page` = `Wiki Document.name` (matches the `:pageId` route param). Resolve `doc_key` + `wiki_space` server-side; permission-gate on `can_contribute_to_space(wiki_space)` — **editor gate, not read gate** (throw `PermissionError` otherwise).

Algorithm:
1. Load the time-ordered published revision set (query above), fields: `name, change_request, message, created_by, created_at`.
2. Batch-load `Wiki Revision Item` for these revisions **and** this `doc_key` in one query; join `content_blob → hash`.
3. Walk chronologically tracking previous `(content_hash, metadata)`. Emit an entry only when the page **changed**:
   - **added** — first revision containing the page (item present, not deleted, no prior).
   - **edited** — `content_hash` differs from prior.
   - **renamed / moved / (un)published** — content unchanged but a tracked metadata field (`title`, `slug`, `route`, `parent_key`, `is_published`, external link) differs. (Classify as `edited` if both content and metadata changed.)
   - **deleted** — item becomes `is_deleted` or disappears after having existed.
   - Skip revisions where nothing about the page changed (dedup via content_hash collapses no-op churn automatically).
4. Enrich: `Wiki Change Request.title` for `change_request` (if set), and author (`User.full_name`, `user_image`) for `created_by`.

Returns newest-first list:
```python
[
  {
    "revision": "abc123",            # Wiki Revision name
    "change_request": "CR-0142",     # or None (git-sync / bootstrap)
    "cr_title": "Fix install docs",  # or None
    "message": "Merge CR-0142",
    "change_type": "edited",         # added | edited | renamed | deleted
    "title": "Installation",         # page title at this revision
    "author": {"name": "hussain@…", "full_name": "Hussain", "user_image": "/files/…"},
    "timestamp": "2026-07-07 10:11:12",
  },
  ...
]
```

### Endpoint 2 — `diff_page_revisions(page: str, revision: str, base_revision: str | None = None)`

`@frappe.whitelist()`. Same `can_contribute_to_space` gate. Diffs the page between `revision` and its predecessor. If `base_revision` is omitted, derive the predecessor = the previous **history entry's** revision (the last published revision before `revision` where the page changed); `None` predecessor ⇒ page was added, base content is empty.

Return shape mirrors `diff_change_request(scope="page")` so `DiffViewer.vue` consumes it unchanged:
```python
{
  "doc_key": "…",
  "base": {"title": …, "content": …, "route": …, "is_published": …} | None,
  "head": {"title": …, "content": …, "route": …, "is_published": …} | None,
}
```
Resolve `content` from `content_blob` via `Wiki Content Blob.content`.

## Frontend

### Route

Add a child under `/spaces/:spaceId` in `frontend/src/router.js`, sibling of `SpacePage`:
```js
{
  path: 'page/:pageId/history',
  name: 'PageHistory',
  component: () => import('@/components/PageHistory.vue'),
  props: true,
}
```

### Entry point

Add a **"View history"** item to the page kebab (⋯) menu in `WikiDocumentPanel.vue` (near `PageSettings`), **shown only when the user can contribute** — reuse the existing `capabilitiesResource.can_contribute` pattern from `ContributionReview.vue`. Not rendered for plain readers. On click: `router.push({ name: 'PageHistory', params: { spaceId, pageId } })`. The panel already has `spaceId` (prop) and the document (`wikiDoc.doc`).

### `PageHistory.vue`

Master–detail, styled to match `ContributionReview.vue` (header bar, `Badge`, avatars, responsive collapse):

- **Header** — Back button (returns to the page), page title, breadcrumb.
- **Left list** — `get_page_history(page=pageId)` via `createResource`. Each row: author avatar, relative time, `change_type` badge, and `cr_title`/`message` with a link to the CR review (`ChangeRequestReview`) when `change_request` is set. Newest first; auto-select the newest on load.
- **Right detail** — on select, `diff_page_revisions(page, revision)` → feed `base.content`/`head.content` into `DiffViewer` (`oldContent`/`newContent`, `fileName` = page title, split/unified toggle reused from the CR review).
- **States** — loading skeletons; **empty state** when the page has only one version ("No earlier versions of this page yet."); error surface.
- **Mobile** — full-screen; list stacks above the diff (mirror `ContributionReview` breakpoints). i18n every string via `__()`.

Change-type badge themes: `added` green, `edited` blue, `renamed` gray, `deleted` red.

## Tracer bullets (build order)

Each slice is a thin vertical cut through all layers — ship and eyeball before the next.

1. **List end-to-end.** `get_page_history` + route + `PageHistory.vue` rendering the revision list only (no diff). Kebab entry point. → Click History, see the timeline.
2. **Diff.** `diff_page_revisions` + wire `DiffViewer` into the detail pane; auto-select newest. → Select an entry, see the content diff.
3. **Polish.** change-type badges, author enrichment, CR links, empty/loading/error states, mobile layout, i18n sweep.

Commit the spec first, then one commit per slice (per CLAUDE.md).

## Tests

Per CLAUDE.md regression protocol (temp-revert to confirm the test bites):

- **Backend unit** (`test_wiki_revision.py` / history module):
  - Page edited across N merges ⇒ history length = number of changing revisions; unchanged revisions skipped.
  - Classification: added / edited / renamed / deleted each produce the right `change_type`.
  - Identical content re-saved (same blob) ⇒ **no** spurious entry.
  - Three-way merge with a concurrent merge ⇒ the concurrently-merged revision still appears (guards the "don't walk parent_revision" decision).
  - `diff_page_revisions` returns correct base/head content; omitted `base_revision` picks the right predecessor; added-page ⇒ empty base.
  - Permission: **non-contributor** (read-only user) ⇒ `PermissionError` on both endpoints; contributor ⇒ allowed.
- **E2E** (Playwright): space + page, make 2–3 edits via CR merges, open History, assert entries render and the diff shows the change. (Local run: `BASE_URL=http://wiki.localhost:8000` — see memory.)

## Edge cases

- **`pageId` = Wiki Document name**, resolved server-side to `doc_key` + `wiki_space` (centralizes permission + space lookup).
- **Deleted pages** — history of a live page only; browsing history of an already-deleted page is out of scope this iteration.
- **Never-changed page** — exactly one entry (added); empty diff state.
- **Non-CR revisions** (bootstrap / git-sync) — `change_request` is `None`; show `message` instead of a CR link.
- **Overlay/working revisions never leak** — filter excludes them, so unmerged drafts never appear in published history.

## Out of scope (future issues)

- Space-wide history timeline.
- Restore/revert a page to a past revision (would seed a Change Request).
- "View at this point" standalone render, cross-page compare, blame/annotate.
