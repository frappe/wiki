# Architecture

## Overview

- `wiki/` is the Frappe app (Python).
- `frontend/` is the SPA (Vue 3, Pinia, Frappe UI). It is served at `/wiki-app`.
- Readers see server-rendered Jinja pages at each page's own route. The SPA is the app for logged-in users: browsing spaces, editing and review.
- The schema lives in `wiki/**/doctype/*/*.json`. Read the JSON when this file and the code disagree.

## DocTypes

### Live content

- **Wiki Space** (`wiki/wiki/doctype/wiki_space`): a wiki. Holds branding, navbar, tabs, access roles and git sync settings.
  - `root_group` links the space's root Wiki Document.
  - `main_revision` links the revision that matches the live tree.
  - `roles` (Wiki Space Role) sets who can read and who can write.
- **Wiki Document** (`wiki/frappe_wiki/doctype/wiki_document`): one page or group. It is a NestedSet tree under the space's root group.
  - `doc_key` is the stable identity of a page across revisions. Names are not.
  - `sort_order` sets sibling order. Readers sort by it, not by `lft`.
  - `wiki_space` is stamped on save so permission queries do not walk the tree.
- **Wiki Feedback**: reader ratings and comments for a page.

### Editing

- **Wiki Revision**: a snapshot of a space's tree at one point.
- **Wiki Revision Item**: one page inside a revision. It holds the tree fields (`doc_key`, `parent_key`, `order_index`, title, slug, route, flags) and a link to a content blob.
- **Wiki Content Blob**: page markdown, named by hash and stored once. Two revisions with the same page text share one blob.
- **Wiki Change Request**: a proposed set of changes to one space, with a review status.
- **Wiki Merge Conflict**: one page that a merge could not combine on its own.

### Git sync

- **Wiki GitHub Connection**, **Wiki Git Sync Log**, **Wiki GitHub Webhook Log**: link a space to a GitHub repo and record each sync.

### Legacy (Wiki v2)

- Wiki Page, Wiki Sidebar, Wiki Group Item, Wiki Page Patch, Wiki Page Revision and Migrate to Wiki are the v2 model.
- New code does not use them. They stay so `Wiki Space.migrate_to_v3` can move old sites over.

## Revisions

A revision is either full or an overlay.

- **Full revision**: one item row for every page in the space. `main_revision` and merge revisions are full.
- **Overlay revision** (`is_overlay = 1`): holds only the items that differ from its `parent_revision`. A change request's head revision is an overlay.
  - `get_effective_revision_item_map` reads the parent's items, then lays the overlay's items on top.
  - `ensure_overlay_item` copies an item from the parent the first time it is edited (copy on write). So a new change request costs one row, whatever the size of the space.
  - A deleted page is an overlay item with `is_deleted = 1`.
- Each revision keeps `tree_hash`, `content_hash` and `doc_count`. Writes set `hashes_stale`, and `ensure_revision_hashes` recomputes on the next read. `has_revision_changes` compares the hashes to tell whether a change request changes anything.

Code: `wiki/frappe_wiki/doctype/wiki_revision/wiki_revision.py`.

## Change requests

Page content and tree edits in the SPA go through a change request. The one exception is page SEO settings (meta title, description, image, `disable_indexing`): `WikiDocument.update_meta` writes them straight to the live page, since no revision carries them.

### Lifecycle

| From                     | Action                    | To                | Who                   |
| ------------------------ | ------------------------- | ----------------- | --------------------- |
| Draft, Changes Requested | `submit_change_request`   | In Review         | Change request writer |
| In Review                | `withdraw_change_request` | Draft             | Author or manager     |
| In Review                | `approve_change_request`  | Approved          | Space writer          |
| In Review, Approved      | `request_changes`         | Changes Requested | Space writer          |
| In Review, Approved      | `reject_change_request`   | Rejected (final)  | Space writer          |
| Approved                 | `merge_change_request`    | Merged            | Space writer          |
| Any                      | `archive_change_request`  | Archived          | Change request writer |

- "Change request writer" means write permission on the change request (`wiki_cr_has_permission`): the user can contribute to its space. The server does not check that they own it.
- "Space writer" means Write access to the space (`can_write_space`).
- A change request can be edited only in **Draft** and **Changes Requested** (`_assert_editable`), by any change request writer.
- `submit_change_request` throws if the draft changes nothing.
- `request_changes` and `reject_change_request` need a comment. It is stored in `review_comment`.
- Merge needs **Approved**. Approval and merge are two separate actions.

### Creating a draft

- Opening a space calls `get_space_bootstrap` (`wiki/api/wiki_space.py`). It returns the space, the user's capabilities in it and, if they can contribute and the space is not git-synced, their draft from `get_or_create_draft_change_request`. That returns the user's open draft for that space, or creates one.
- The draft tree (`get_cr_tree`) and its change summary load after the bootstrap, as separate requests. The editor opens without waiting for them, and a failed tree load offers Reload latest.
- Otherwise the space is read-only for that user. `space.js` loads the live tree with `get_wiki_tree` and opens no draft.
- A draft whose base is behind `main_revision` and that changes nothing is archived, and a fresh one is created.
- `create_change_request` sets `base_revision` to the space's `main_revision` and creates an empty overlay on top of it as `head_revision`.
- If the space has no `main_revision` yet, it snapshots the live tree first.

### Editing a draft

- The client sends edits in batches to `apply_cr_operations`. Operation types: `create_node`, `update_node`, `update_content`, `delete_node`, `restore_node`, `move_node`, `reorder_children`.
- A batch runs in one transaction, so it applies fully or not at all.
- A new page gets a `tmp_*` key on the client. The server assigns the real `doc_key` and returns the mapping in `temp_key_map`.
- The response also carries the affected items and the change summary (`changes`), so a save is one request. The client does not refetch the page or the summary after it.
- Each change request has an `operation_version`. The client sends the version it last saw as `base_version`. If the server is ahead, it returns `version_conflict` and applies nothing.
- After a conflict the client blocks every save until the user clicks Reload latest. Reload keeps local edits to a page only if its server copy has not changed since this tab loaded or saved it. Otherwise the server copy replaces them. A browser reload restores drafts with the same check.
- `_lock_and_load_cr` takes a row lock on the change request, so two writers to one draft run one after the other.
- `get_cr_tree` and `get_cr_page` read the draft. `diff_change_request` returns the change summary and page diffs for review.

Code: `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py`.

## Merge

`merge_change_request` picks one of two paths.

- **Fast forward**: the change request's `base_revision` still equals the space's `main_revision`. The effective head items become the merge revision.
- **Three-way merge**: the space moved on since the draft started. Base is the draft's base, "ours" is the current `main_revision`, "theirs" is the draft's head.
  - Only pages that changed on either side are compared.
  - `merge_items` merges fields. `merge_content_three_way` merges markdown line by line and accepts edits that do not overlap.
  - Any page it cannot combine becomes a Wiki Merge Conflict (`content`, `meta` or `tree`). The merge commits the conflict rows and throws.
  - A user with write access picks `ours` or `theirs` per conflict (`resolve_merge_conflict`), then calls `retry_merge_after_resolution`.

Both paths then:

1. Write a full merge revision (`create_merge_revision`).
2. Apply only the pages that changed to the live Wiki Document tree (`_apply_merge_changes_only`). Content-only changes skip the document save.
3. Point `main_revision` at the merge revision.
4. Mark the change request Merged and clear the tree cache.

`frappe.flags.in_apply_merge_revision` is set while the merge writes to Wiki Document. It stops those writes from queuing a second snapshot and lets the merge write to git-synced spaces.

## Changes outside change requests

The live tree can also change without a change request. Each path keeps `main_revision` in step.

- **Desk edits**: a Wiki Document save that changes a revision field calls `queue_main_revision_sync`. Before the transaction commits, `flush_pending_revision_syncs` snapshots each touched space once and sets a new `main_revision`. Code that reads `main_revision` flushes first, so it never sees a pending snapshot.
- **Direct reorder** (`reorder_wiki_documents`): moves documents with raw writes, rebuilds the nested set only if the parent changes, then snapshots the space right away.
- **Git sync** (`wiki/wiki/git_sync.py`): builds a target revision from the repo, then applies it with the same `_apply_merge_changes_only` step as a merge. A git-synced space is read-only in the wiki (`assert_space_writable`). The repo is the source of truth.

## Permissions

Code: `wiki/permissions.py`, wired through `has_permission` and `permission_query_conditions` in `hooks.py`.

- System Manager, Wiki Manager and Administrator can do everything.
- A space with no role rows is open: any logged-in user can read, and Wiki Approvers can write.
- A space with role rows grants Read or Write per role. Write includes Read. Adding the `Guest` role at Read makes a space public.
- Read lets a user view pages and raise change requests, if the space's `allow_contributions` is on.
- Write lets a user approve, reject and merge change requests.
- A page in a space the user cannot read returns 404, not 403, so its existence does not leak.

## Reading

- `page_renderer` in `hooks.py` runs two renderers.
  - `CrawlerRenderer` (`wiki/wiki/crawler_renderer.py`) serves `llms.txt`, per-space `llms.txt`, `sitemap.xml` and `<route>.md`.
  - `WikiDocumentRenderer` serves a published page at its route with `templates/wiki/document.html`. A group route redirects to its first page. With `Accept: text/markdown` it returns the page markdown.
- `get_page_data` returns page data for client-side navigation inside an already rendered space.
- Redis caches:
  - `wiki_public_tree`: the sidebar tree per root group (`get_public_wiki_tree`). Cleared by `clear_wiki_tree_cache` on any Wiki Document change and after each merge.
  - `wiki_rendered_content`: rendered HTML and TOC per page. Cleared when that page's content changes.
- Reader search uses Frappe's SQLite search index (`wiki_sqlite_search.py`, queried by `wiki_document/search.py`).
- SPA search (`wiki/api/search.py`, the command palette) matches routes only.

## Frontend

- Entry: `frontend/src/main.js`, `App.vue`, `router.js`. Vite builds into `wiki/public/frontend` and writes `wiki/www/wiki-app.html`. `wiki/www/wiki_app.py` adds boot data (CSRF token, site info, and the user from `get_user_info`, so the app does not fetch it).
- Pages: `Overview`, `AllSpaces`, `Contributions` (change request list), `ContributionReview` (diff and review), `SpaceDetails` (the editor shell).
- Inside a space:
  - `WikiDocumentPanel` opens a page that exists in the live tree.
  - `DraftContributionPanel` opens a page that exists only in the draft.
  - Both edit through the draft workspace store.
- Stores (`frontend/src/stores`):
  - `space.js`: the current space, its tree and its git sync state.
  - `changeRequest.js`: the current change request and its review actions.
  - `draftWorkspace.js`: the optimistic draft state. It coordinates the modules in `draftWorkspace/`: `operationQueue` (pending edits), `syncTransport` (batches to `apply_cr_operations` and handles `version_conflict`), `tempKeyResolver` (`tmp_*` to real keys), `moveScheduler` (debounced drags), `saveSerializer` (one save in flight per page) and `pageBuffers` (editor buffers).
  - `draftPersistence.js`: unsaved page content in IndexedDB, so a reload keeps it.
- Realtime: the SPA listens for `wiki_change_request_update` and `wiki_git_sync_update`.
