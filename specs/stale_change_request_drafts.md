# Stale Change Request Drafts

Date: 2026-09-24
Status: Implemented & verified on wiki.localhost (2026-09-24)

## Problem

An author edits a page, submits it for review, and goes back to the space while
the change request (D1) is still In Review. Opening the space asks for a draft,
finds none (D1 is no longer a Draft), and creates D2 on the current main
revision, which does not contain D1 yet. Two things then go wrong:

1. The draft workspace keeps D1's page buffers. The editor shows D1's text on
   top of D2, and the next keystroke autosaves D1's edit into D2. Two change
   requests now carry the same edit.
2. When D1 merges, D2 stays on the old main. A draft that has any change is
   never archived or rebased, so pages D2 did not touch show pre-merge content.
   The merged change looks lost in the editor. Merging D2 later reports a
   conflict against the author's own merged edit.

The review page also only loads merge conflicts after a merge fails on that
page. Arriving from the sidebar Merge shows a conflict toast with no resolve UI.

Reproduction and evidence: https://claude.ai/artifact/5FR5jYwfTYiYCbzTii899t

## Out of scope

Creating the draft on first write instead of on open. Tracked as a follow-up
(`fix/lazy-draft-change-request`).

## Plan

### Phase 1: rebase outdated drafts (backend)

A draft's head is an overlay revision: it holds only the items the draft
touched, on top of `parent_revision` (= `base_revision`). When main has moved:

- Find keys main changed since the draft's base (`_find_changed_keys`).
- If none of them is in the overlay, repoint the overlay's `parent_revision`
  and the CR's `base_revision` to the current main, clear `outdated`, and mark
  hashes stale. The draft now shows main plus its own edits.
- If any key overlaps, leave the draft as is. The merge's three-way path
  resolves or reports those conflicts.

This runs when the author opens a draft (`get_or_create_draft_change_request`)
and replaces the "archive stale empty draft" branch: an empty draft has no
overlay items, so it always rebases.

### Phase 2: reset the workspace when the change request changes (frontend)

`hydrate()` only resets local state when the space id changes. Track the CR the
buffers belong to and reset (keeping the tree on screen) when `hydrate()` lands
on a different CR. Every entry point goes through `hydrate()`, so Submit, the
review page's `mergeNow()` and the sidebar all get the fix.

### Phase 2b: the editor adopts newer server text (frontend)

Found while verifying phase 2. `WikiEditor` seeds its content once and never
applies later prop changes. When a background refetch (or a rebased draft)
brings a newer `savedContent`, the watcher reported the old on-screen text
against the new saved text, the store marked it dirty, and autosave wrote the
stale text back. After a rebase that reverted the merged change inside the
draft. Fix: when the editor still matches the previous saved snapshot (nothing
typed since), load the new saved content into the editor instead.

### Phase 3: load conflicts on the review page

Fetch open conflicts when the review page loads a CR in Approved state, so the
resolve UI shows no matter where the merge was started.

### Phase 4: e2e

Playwright (`e2e/tests/stale-draft-after-merge.spec.ts`): edit A, submit, go
back, edit B, a reviewer tab approves and merges, the author leaves and
re-enters the space without a reload, then reloads. Page A shows the merged
text both times, one draft remains, and its diff holds only B. A second test
checks the review page lists conflicts from a merge started elsewhere.

## Known limits

- A merge done in another session reaches an author's open SPA only when the
  draft is hydrated again (re-entering the space or a reload). A live refresh
  would need a realtime event on merge.
- A draft that touched a page main also changed keeps its old base. The merge
  reports the conflict as before.

## Progress log

- Phase 1: `_rebase_draft` / `_can_rebase` replace the stale-empty archive.
  Four unit tests; each fails with its guard reverted. 121 CR tests pass.
- Phase 2: `hydrate()` tracks `hydratedCrName` and resets buffers on change.
- Phase 2b: `WikiEditor` savedContent watcher adopts server text when clean.
- Phase 3: review page watches `canReview && status == Approved`.
- Phase 4: e2e passes; it fails with each of phases 1, 2 and 2b reverted.
  `change-request-flow` and `local-first-store` specs pass except one test
  that also fails on develop locally (reader `networkidle` never settles
  because of the keepalive page-view beacon when view tracking is on).
- Large-space check on wiki.v2.localhost (952-page space, 7,319 revisions,
  1.7M revision items). Rebasing a draft takes 60 ms and the slowest
  `_can_rebase` over 776 real outdated drafts takes 46 ms. 732 of those 776
  would rebase. The browser flow passes on the 952-page space, and the e2e
  spec passes on this site too.
- 2026-09-26: typing kept in IndexedDB is not in the overlay, so the rebase on
  reload moved the draft under it and the typing was saved over main's newer
  text. `get_draft_workspace` now takes `unsaved_doc_keys` (every doc key with
  a persisted draft) and treats them as touched. Unit test and e2e test fail
  with it reverted.
