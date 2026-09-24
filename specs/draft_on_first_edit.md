# Draft on First Edit

Date: 2026-09-24
Status: Planned
Depends on: `fix/stale-change-request-drafts` (PR1, `_rebase_draft`)

## Problem

Opening a space creates a Draft change request for the viewer, even if they
never edit anything. Every open runs `hydrate()`, which calls
`get_or_create_draft_change_request`:

- `frontend/src/stores/space.js:276`, `draftWorkspace.js:230`
- `wiki_change_request.py` `get_or_create_draft_change_request`

Each visit inserts a `Wiki Change Request` and an overlay `Wiki Revision`.
wiki.v2.localhost has 1,054 Drafts, most of them empty visits. They fill the
Change Requests list and its count, and every one is a row the rebase and
merge paths have to consider.

The draft exists that early because the editor reads the tree and pages only
through a change request (`get_cr_tree`, `get_cr_page`).

## Goal

Opening a space writes nothing. The draft is created on the first edit: a save,
a create, a move or delete, or unsaved typing that needs a change request to be
kept under across a refresh.

## Prior work

Branch `fix/lazy-draft-change-request` (2026-09-23, not pushed) has a working
version of this, written before PR1:

- `d9d83d3` does most of this spec. We reuse it, adapted as below.
- `30e6383` rebases only empty stale drafts with a new overlay. PR1's
  `_rebase_draft` replaces it, so we drop it.
- `15d4d64` makes the page view fetch read its response, so Playwright's
  `networkidle` settles on reader pages. It has nothing to do with drafts, so
  it goes in its own PR.

## Plan

### Phase 1: read the workspace without creating a draft (backend)

- Add `get_draft_workspace(wiki_space)`. It returns
  `{"change_request": <open draft or None>, "tree": <tree>}`.
  - With an open draft, run PR1's `_rebase_draft` first. This keeps symptom 1
    fixed now that opening a space goes through this endpoint. A rebase only
    repoints an existing draft and never creates one.
  - Without one, build the tree from the space's main revision.
- Move `get_cr_tree`'s body into `_build_revision_tree(wiki_space,
  head_revision, base_revision=None, change_map=None, operation_version=0)`,
  so both endpoints share it.
- Add `_assert_can_draft(wiki_space)` (read access, contributions accepted,
  space writable), used by both endpoints.
- Add `_ensure_main_revision(wiki_space)`. A fresh space with no main revision
  still gets one bootstrapped, as `create_change_request` does today. That is
  a one-time write per space, not per visit.
- `get_or_create_draft_change_request` stays. It is what the first edit calls.

Tests:
- Opening a space creates no change request, and the tree lists its pages.
- An open draft is returned with its edited tree.
- An outdated draft is rebased on open (PR1 behaviour through the new endpoint).
- A git-synced space refuses `get_draft_workspace` like it refuses
  `get_or_create_draft_change_request` today.

### Phase 2: hydrate from the workspace endpoint (frontend)

- `syncTransport.fetchWorkspace(spaceId)` calls `get_draft_workspace`.
- `hydrate()` uses a new `loadWorkspace()`: set `currentChangeRequest` from the
  response (possibly null), load the change summary, apply the tree. PR1's
  `hydratedCrName` reset stays: a submitted CR followed by no draft counts as a
  change and clears the old buffers.
- `WikiDocumentPanel` and `DraftContributionPanel` gate re-hydration on
  `draftStore.hasLoadedTree` instead of on having a change request. Otherwise
  a viewer with no draft re-hydrates on every page open.
- `DraftContributionPanel` treats a missing page as missing once the tree has
  loaded, not once a change request exists.
- `reloadTree()` and `space.refreshTree()` reload the workspace when there is
  no change request, instead of doing nothing.
- With no change request, a page renders from the published document, which is
  what `WikiDocumentPanel`'s `editorContent` already falls back to.

### Phase 3: create the draft on the first edit (frontend)

- Saves, creates, deletes and restores already call `ensureCr()`.
- Moves: `moveScheduler.flush()` calls `ensureCr()` instead of returning early
  when there is no change request. A drag can be the first edit.
- Typing: `persistEditorDraft` calls `ensureCr()` when the buffer is dirty and
  no change request exists yet, then persists. Without this, a refresh inside
  the ten-second autosave window loses the typing.

### Phase 4: e2e

- New `e2e/tests/draft-on-first-edit.spec.ts`: open a space, see the tree and
  page content, assert zero change requests. Type, then assert exactly one
  Draft. Reload before autosave and the typing is still there.
- Update specs that expected a draft right after opening a space:
  `change-request-flow`, `contributions-disabled`, `local-first-store`,
  `spa-editor.mobile`, `pending-delete-visible`.
- `createDraftAndOpenEditor` waits with `waitFor({ state: 'visible' })`.
  `isVisible()` ignores its timeout, reloads too early and aborts the create.
- PR1's `stale-draft-after-merge.spec.ts` must still pass.

## Risks to verify

- **Editor baseline when the draft is created mid-typing.** The page buffer is
  created by the first keystroke, before any change request exists. Check that
  `savedContent` becomes the published text and PR1's `WikiEditor` watcher does
  not replace what the user typed.
- **Tree refetch racing a create.** In `d9d83d3`, re-hydrating on mount could
  land a refetched tree between the draft's creation and the page create,
  dropping the new row. The `hasLoadedTree` gate is the fix. Cover it with the
  existing create-page e2e specs.
- **Two tabs, first edit in both.** Both call `get_or_create_draft_change_request`.
  `_find_existing_draft` returns the same draft for the second call once the
  first commits. Check that the in-flight dedupe in `initChangeRequest` holds
  within one tab, and that two tabs end up with one draft.
- **Large spaces.** On wiki.v2.localhost (952 pages) opening a space took about
  1 s with `get_cr_tree` twice. Check `get_draft_workspace` is not slower and
  the tree is fetched once.

## Out of scope

- Cleaning up the empty drafts already in the database. Rebase keeps them
  correct. Deleting them would be a separate patch, if wanted.
- A live refresh when someone else merges while the space is open.

## Progress log
