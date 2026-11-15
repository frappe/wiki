# Edit Without the Change Request Dialog

## Why

Edit opens a "New change request" dialog that asks for a title and a description before the editor opens. Users find this friction: they have not changed anything yet, so they do not know what to call the change. This reverses decision 1 of `edit_flow.md` (title first, not on submit).

## What

- Edit starts the change request at once, with a placeholder title. No dialog.
- Submit for review asks for the title and the description. The title field holds the placeholder, so the user can keep it or replace it.

Placeholders (space "Frappe HR Docs", page "Leave Policy"):

| Entry point | Placeholder |
|---|---|
| Edit on a page, `?edit=1` | `Edit Leave Policy in Frappe HR Docs` |
| New page from the tree, the welcome screen or the command palette | `New page in Frappe HR Docs` |
| New group | `New group in Frappe HR Docs` |
| New external link | `New link in Frappe HR Docs` |

Reorder is only possible in Editing, so it never starts a change request and needs no placeholder.

## How

- `useStartEditing().requireEditing(title)` calls `get_or_create_draft_change_request(wiki_space, title)`. That method already reuses the user's open draft in the space and archives a stale empty one, so Edit never piles up drafts. No backend change.
- `StartEditingDialog` goes away. The empty space special case ("Add initial content") goes too: every entry point now starts without a dialog.
- The Edit button shows a loading state while the change request is created.
- `SubmitForReviewButton` always shows Title (required, prefilled) and Description (prefilled). It saves them with `update_change_request` when they changed, then submits. The `Draft Changes - ` prefix check goes away.

Empty drafts left by an Edit with no changes stay out of other users' sight. The space panel and the "Assigned" and "All" tabs only list submitted change requests. The author sees their own draft in "My" and lands back in Editing until main moves on.

## Tracer bullet

1. Edit starts a titled draft, Submit asks for title and description. Update the e2e helpers (`editPage`, `startEditing`, `openNewPageDialog`) and the `edit-flow` cases that drove the dialog.
   - Playwright: Edit opens the editor with no dialog and the draft is titled `Edit <page> in <space>`. `?edit=1` does the same. New page in Reading creates `New page in <space>`. Submit shows the placeholder, takes a new title and description, and the submitted change request has both.

## Progress
