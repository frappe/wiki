# Partial Change Request Submit — split the draft on submit

Date: 2026-09-07
Status: **Implemented (2026-09-07).** As-built notes inline.
Issue: [frappe/wiki#761](https://github.com/frappe/wiki/issues/761)

## Problem

A change request is space-level: `get_or_create_draft_change_request` reuses the author's
single open draft per space (`_find_existing_draft`), so every page edited before submitting
lands on one CR's head revision. Approve and Merge act on the CR, so they take every page in
it. #761 reports this as "approving one draft merges the others" — reproduced, and confirmed
to be the model rather than a status cascade: three *separate* CRs stay independent.

The author has no way to send one page for review and keep working on the rest. Their only
option today is to submit after every page.

## Goal

Let the author choose which changes go into review. Unselected changes stay behind in a draft
they can keep editing.

**Non-goal:** per-page approval on the reviewer side. Once submitted, a CR is still reviewed
and merged as one unit. Splitting at submit gives the same outcome with a much smaller blast
radius than teaching approve/merge to work on a subset.

## Model

Submit takes an optional set of `doc_keys`.

- Omitted (or covering every change) → today's behaviour exactly.
- A subset → the **unselected** changes are moved out into a new `Draft` CR off the *same
  base revision*, and the original CR is submitted with what is left. The submitted CR keeps
  its name, so the review route and the author's local draft store are unaffected.

Moving a change means re-pointing its `Wiki Revision Item` row from the old head revision to
the new one. Content blobs are shared and immutable, so nothing is copied. Both revisions are
marked `hashes_stale`; `has_revision_changes` recomputes on next read.

### Dependency closure

A selection is expanded so neither CR is left referencing a page its base does not have:

- **Up** — for a selected key, every ancestor in the head tree that is *new in this CR*
  (changed and absent from the base) comes along. Otherwise the submitted tree has a
  `parent_key` pointing at a page that does not exist yet.
- **Down** — a selected key that is new, or deleted, pulls its changed descendants. A new
  group travels with its new pages; a deleted group travels with the descendants the delete
  cascade already marked (`_delete_cr_item`).

The closure runs server-side and the response reports what it added, so the UI can say so.

## Implementation

### Backend — `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py`

- `submit_change_request(name, doc_keys=None)` — unchanged guards (`write` permission,
  `Draft` / `Changes Requested`, has-changes). With `doc_keys`: intersect with the CR's actual
  changed keys, throw `ValidationError` on an empty selection, expand the closure, split off
  the rest, then flip to `In Review`.
  Returns `{change_request, submitted, auto_included, held_back, held_back_change_request}`
  (it returned `None` before; no caller depended on that).
- `_expand_selection(cr, selected, changed)` — the closure above.
- `_split_off_changes(cr, doc_keys)` — new overlay off `cr.base_revision`, new `Draft` CR with
  the same title/space/description, re-point the rows, mark both revisions stale. Returns the
  new CR name, or `None` when there is nothing to move.

### Frontend

- `stores/changeRequest.js`: `submitForReview(docKeys)` passes `doc_keys` and returns the
  server payload merged with the CR name.
- `components/ContributionBanner.vue`: the Submit-for-Review dialog becomes a checkbox list of
  pending changes (all selected by default, Submit disabled with none selected), reusing
  `useChangeTypeDisplay` for the icon/label so it matches the Pending Changes dialog.
- `pages/SpaceDetails.vue`: pass the selection through; when the server held changes back, the
  toast says how many stayed in the draft, and when the closure pulled extra pages in, it says
  that too.

### Tests

- Unit (`test_wiki_change_request.py`): subset submit leaves the rest in a new draft CR;
  merging the submitted CR publishes only its pages; closure pulls an added parent group;
  closure pulls a deleted group's descendants; empty selection throws; a full selection creates
  no second CR.
- E2E (`e2e/tests/partial-submit.spec.ts`): three page drafts, submit one, the other two are
  still editable in the space, and merging publishes one page.

## Notes / limitations

- **Reorders.** A reorder renumbers siblings, so splitting a reorder can move a page's
  `order_index` into a CR whose base has different neighbours. The merge already reconciles
  sort order (`_reconcile_sort_order`); we accept the fuzz rather than forcing the whole
  sibling set into one CR.
- **Local-first drafts.** Submit is already blocked while local mutations are unsynced or the
  editor has unsaved content (`finalizationBlocker`), so no IndexedDB draft can be stranded on
  the wrong CR by the split.
- **Held-back CR is the next draft.** `_find_existing_draft` prefers an open draft with
  changes, so returning to the space picks up the leftover automatically. Verified in
  `test_leftover_draft_is_what_the_author_gets_back`.
- **Merge from the banner is still whole-CR.** A manager's self-serve Merge in the editor
  publishes the entire change request; only submit takes a selection. Splitting first, then
  merging, is the path if they want part of it live.

## As-built

Shipped as specced. Both halves of the backend were verified by temp-revert: dropping the
split fails 3 tests, dropping the closure fails the other 3. Full module: 113 unit tests pass.
E2E `partial-submit.spec.ts` plus the 15 existing `change-request-flow.spec.ts` tests pass
against the built frontend.
