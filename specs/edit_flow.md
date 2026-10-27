# Edit Flow: Explicit Edit, Change Requests in the Space, Version History

Date: 2026-10-21
Status: **Draft spec**. Takes over roadmap items 2.4 (create the draft on first edit, R13) and 2.8 (read mode HTML in the SPA, R10) in `pr-859-roadmap.md`, and issue [#622](https://github.com/frappe/wiki/issues/622) (version history UI).

Prototypes:

- **Final, all parts combined:** [wiki-edit-flow](https://sketch.netchamp.dev/u/gajjug004/wiki-edit-flow). Demo pills: Role (Contributor, Reader) and Change request (Reading, Editing, In review).
- Earlier, superseded by the above: edit flow [wiki-change-request-flow](https://sketch.netchamp.dev/u/gajjug004/wiki-change-request-flow) (variant "start-first"), version history [wiki-version-history](https://sketch.netchamp.dev/u/gajjug004/wiki-version-history).

## Why

Three gaps, one flow.

1. **Opening a space writes.** `get_space_bootstrap` calls `get_or_create_draft_change_request`, so every author who opens a space gets a draft named "Draft Changes - <space>". The author never chose to edit, never named the change, and a reviewer sees a pile of identically named requests. Every SPA page view also loads the editor (320 KB gzip) and parses markdown in the browser, even when the author only came to read.
2. **No view of other change requests in the space.** The space shows only your own draft. You cannot see that someone else already has a change request in review on the page you are about to edit. The only list is the global `/change-requests` page, which is not scoped to the space.
3. **No version history.** Every merge already writes a revision, but nobody can browse them. Revisions are manager-only doctypes (#867) with no UI.

All three meet at one point: the space gets a real read mode. Read mode shows the live page, the open change requests and the page's history. Edit is an explicit step that creates a named change request. Restoring an old version is a change request too.

## Today

- `get_space_bootstrap(space_id)` returns the space, the capabilities and the user's draft. It creates the draft if there is none (`wiki/api/wiki_space.py:169`). POST because it writes.
- `_find_existing_draft` picks the user's Draft or Changes Requested change request in the space. One editable change request per user per space. A change request in review does not count, so a new draft is created on the next space open.
- The SPA already has a read-only path: git-synced spaces and users who cannot contribute (`spaceStore.isReadonly`). It loads the live tree (`get_wiki_tree`, cached per space since #879) and renders the page with `WikiEditor` in read-only mode. The editor chunk still loads.
- `SpaceModeStrip` shows the draft: title, page count, View changes, Discard, Submit, Withdraw, Merge (for managers).
- Change request permissions (`wiki/permissions.py:263`): any space reader can read any change request in the space. Any contributor can write one.
- Revisions: the main chain of a space is every revision with `is_overlay = 0` and `is_working = 0`. A merge writes one with `is_merge = 1` and `change_request` set. Desk edits and live reorders write "Direct reorder" revisions with no change request. Each revision holds one Wiki Revision Item per page (full snapshot, not a delta). Index: `(revision, doc_key)`.
- `DiffViewer.vue` (`@pierre/diffs`) already renders split and unified markdown diffs for the change request review page.

## Design

### Part 1: Explicit Edit

**States.** For a user who can contribute to a non-synced space:

| State | Means | Page shows | Header action |
| --- | --- | --- | --- |
| Reading | no Draft or Changes Requested change request in this space | live page | **Edit** |
| Editing | a Draft or Changes Requested change request | editor on the draft | **Submit for review**, plus **Merge** for users who can merge (decision 7) |
| In review | own change request In Review or Approved, no editable one | live page | **Edit** (starts a new change request) |

Git-synced spaces and users who cannot contribute stay in Reading with no Edit button, as today.

**Edit.** Clicking Edit opens the "New change request" dialog from the prototype: Title (required), Description (optional), action "Start editing". On confirm:

1. `create_change_request(wiki_space, title, description)`. Already whitelisted.
2. The space store switches to the draft: `draftStore.hydrate(spaceId, changeRequest)`, the same entry point the bootstrap uses today.
3. The page remounts in the editor. Focus goes to the end of the page body, not the title.

**Opening a space writes nothing.**

- `get_space_bootstrap` returns the user's existing editable change request or `null`. It never creates one. It becomes a GET.
- `get_or_create_draft_change_request` stays for the agent skill and API callers. The SPA stops calling it.
- The stale empty draft cleanup (`_is_stale_empty_draft`, `_archive_stale_draft`) moves off the read path. Bootstrap ignores a stale empty draft instead of archiving it, so the user lands in Reading.

**Existing auto-created drafts.** Without a cleanup, every author who ever opened a space has an empty "Draft Changes - <space>" draft and would land in Editing. A patch archives Draft change requests with no changes (`has_revision_changes(base, head)` false). Drafts with changes stay, keep their title and open in Editing. The submit dialog asks for a better title when it still matches `Draft Changes - %`.

**Actions that need a change request.** In Reading they open the Edit dialog first, then run:

- New page (tree button, command palette)
- Page menu: Rename, Publish, Unpublish, Delete
- Tree drag to reorder is off in Reading. The tree shows no drag handles.

**The reader's Edit link** (`get_edit_link`) adds `?edit=1`. On load the SPA opens the Edit dialog if the user is in Reading, and goes straight to the editor if they are in Editing. `edit_opens_editor_first.md` still holds for the second case.

**Submit, withdraw, discard, merge.** Unchanged, except Merge moves from the strip to the page header (decision 7). After a merge, a discard or a submit, the user is back in Reading. No new draft is created.

**Editing a change request in review.** The review page of an In Review or Approved change request shows **Edit** to its author and to users who can merge (decision 10). Edit opens the space in the editor on that change request, on the first page it changes.

- The status stays In Review. The first edit to an Approved change request moves it back to In Review and logs "Edited after approval. Back in review." on its timeline, so an approval only covers what the approver saw.
- The strip shows the title, "In review" or "Approved" and the page count. It offers no Discard: the change request may be someone else's.
- The header shows **Done editing** in place of Submit, plus Merge for users who can merge. Done editing goes back to the review page. Merge lands where any merge lands.
- The choice survives a reload in the same tab: the SPA keeps the change request name in `sessionStorage` and passes it to `get_space_bootstrap(space_id, change_request)`, which returns it while the user may still edit it.
- Leaving it, by Done editing or Merge, brings back the user's own draft if they have one.

**Strip.** In Editing the strip shows the change request title (click to edit title and description, `update_change_request`), status and page count. In Reading there is no strip. The space's open change requests, the user's own included, live in the page header panel (Part 3).

### Part 2: Read mode without the editor (roadmap 2.8)

In Reading the page renders the cached server HTML. The editor chunk loads only when the user enters Editing.

- New whitelisted `get_page_html(name)`: `doc.check_permission("read")`, then `get_rendered_content` (Redis cached) and `resolve_wiki_links`. Returns `html`, `toc`, `modified`, `modified_by`. Works for unpublished pages: the SPA shows them to space readers today.
- `WikiDocumentPanel` picks `WikiPageReader` (new, small) in Reading and `WikiEditor` in Editing. `WikiEditor` becomes a `defineAsyncComponent` import, so its chunk and `wiki-starterkit` load on Edit.
- `WikiPageReader` renders the HTML inside `.wiki-rendered` and runs the reader's block scripts from `wiki/public/js/`: code block copy, image viewer, mermaid, PDF viewer. Port them as ES modules the SPA and the reader both import, rather than copying. The reader's content styles (callouts, code blocks, tables, images, PDF cards) move out of `main.css` into one `wiki/public/css/wiki-rendered.css`, scoped to `.wiki-rendered`, which both surfaces import.
- The outline uses the server `toc`.
- Prefetch: hovering Edit, or opening the Edit dialog, starts the editor chunk download, so the editor is ready by the time the user confirms the title.

Baseline (2026-10-20, `perf-763510` page, Administrator, gzip): app 273 KB, editor 320 KB, echarts 211 KB. The echarts chunk is a separate fix (`SpaceSettings.vue` imports `AnalyticsDashboard` statically) and can ship before this spec.

Target: a page view in Reading loads no `wiki-starterkit` and no `WikiEditor` chunk, and draws the article sooner than today. Measure time to article visible, median of 5, 100 ms latency, before and after.

### Part 3: Change requests in the space

**Change requests panel.** A "Change requests" button with the open count sits in the page header, beside the history button, in both states. It opens a panel on the right in the slot that history and page settings use (Part 4). The panel lists the space's open change requests in two groups: "Changing this page" first, then "Elsewhere in this space". When none touch the page, one group headed "In this space". Rows: title, author avatar, status badge, page count, updated time. A row opens the review page (`/change-requests/<name>`). Empty state: "No open change requests".

The sidebar stays for the page tree. No change requests section there.

Which change requests show:

- In Review, Changes Requested, Approved: everyone's.
- Draft: your own only. A draft is unfinished work and has no title worth reading until it is submitted.
- Merged, Rejected, Archived: no. History covers merged ones (Part 4).

Data: `list_change_requests(wiki_space, status)` already exists and is permission-checked through `get_list`. Add `changed_doc_keys` to each row, from the same summary `diff_change_request` builds (13.6 ms median on a 1,021-item space). The page count is its length. One call per space feeds the header count, the panel groups and the page notice: the SPA filters by the current `doc_key`, so there is no per-page endpoint. Open change requests per space are few, so N summaries per call is fine. 3.3 (change summary kept on write) makes it one query later.

**Page notice.** In Reading, when other open change requests change the current page, a bar under the header shows "2 open change requests change this page" with a dropdown to each. This is the warning that stops a second author editing the same page blind. The bar hides while the change requests panel is open, since the panel's first group says the same thing.

### Part 4: Version history (issue #622)

**Entry points.** A history button in the page header (both states) and "Last modified <time>" under the article. Both open the history panel on the right, where the page settings panel sits today. History, page settings and change requests (Part 3) share the slot, one at a time.

**Panel.** As in the prototype:

- Scope toggle: This page, Whole space.
- "Current version" at the top, then versions grouped by Today, Yesterday, This week, Earlier.
- Each row: author, "merged #<cr>", "edited in Desk" or "synced from <commit>" (decision 8), change request title, time, and what changed (edited, renamed from X, added, deleted).
- Selecting a version shows its diff in the main area: split or inline, "Show changes only". Reuse `DiffViewer.vue` (markdown diff), not the prototype's block diff.

**Data.** New `wiki/api/history.py`, both whitelisted, both check `can_read_space`:

- `get_page_history(wiki_space, doc_key, limit, start)`: main-chain revisions of the space, newest first, joined to their item for `doc_key`. Keep a revision only where the item's `content_blob`, `title`, `route`, `is_published` or `is_deleted` differs from the previous kept one. Returns revision name, change request (name, title), `source_commit`, author (`created_by`), `created_at`, change type, old title.
- `get_space_history(wiki_space, limit, start)`: main-chain revisions with a change request, a Desk edit or a sync, with the list of pages each one changed (diff against the parent revision's items, as `diff_change_request` does).
- `get_revision_page(revision, doc_key)`: the item's content and title, for the diff. Diff target is the previous kept version.

These run as the session user. The revision doctypes stay manager-only: the API reads them with `ignore_permissions` after the space check, like `get_cr_tree` reads overlay items.

Cost: one Wiki Revision Item row per page per revision (3.6 not done), so a page's history query reads one row per main revision of the space through the `(revision, doc_key)` index. Paginate at 50. Measure on `perf-big-1000`.

**Restore.** Restore is a change request, never a direct write.

- Page scope, "Restore this version": in Editing, the content goes into the current draft as an `update_content` operation. In Reading, the Edit dialog opens with the title "Restore <page>" filled in, then the same operation runs.
- Deleted page, "Restore page": a `restore_node` operation if the doc_key is in the draft's base, else a `create_node` with the old content, title and parent.
- Space scope, "Revert changes" of a whole merge: later. It needs per-page three-way handling when pages changed again after that merge.

## Decisions

1. **Title first, not on submit.** The prototype had both variants. Start-first wins: Edit is the moment of intent, the title tells reviewers and other authors (Part 3) what is in flight from the start, and it removes the untitled drafts.
2. **One editable change request per user per space.** Same as today. The draft store, IndexedDB drafts and the strip all assume one current change request. Several parallel drafts per space is a separate feature.
3. **Read mode shows the live page, not the draft.** In Editing you see your draft in the editor. Reading never mixes in draft content, so it can use the cached HTML.
4. **Others' drafts stay hidden.** Only submitted work is public in the change requests panel.
5. **History is for space readers.** They can already read every page and every change request in the space.
6. **Change requests live in a page header panel, not the sidebar.** The prototype tried five placements: a sidebar section, sidebar tabs, a bottom tray, a popover in the space header and a popover beside history. A sidebar section pushed the page tree down. Tabs hid the tree. The tray and the popovers had no room to group by page. The panel reuses the right slot history already needs, keeps the tree whole, and has room for "Changing this page".
7. **Users who can merge get "Merge" beside "Submit for review".** For small fixes. Shown only when `_can_merge(space)` is true. It reuses `approveAndMergeChangeRequest`, which the strip already uses: submit, approve, merge. The change request still exists and keeps its title, so history shows "merged #<cr>" like any other merge.
8. **Git sync shows in history as "Synced from <commit>".** Sync writes a main-chain merge revision with no change request. A new `source_commit` field on Wiki Revision holds the commit sync applied (`head_sha` in `git_sync.py`). The row links to the commit when the space has a repo URL. Sync revisions written before this field show "Synced from Git". A synced space is read-only in the SPA, so its history has no Restore.
9. **History is SPA only.** The public reader gets no history link. Readers who want history open the space in the SPA.
10. **A change request in review stays editable for its author and for users who can merge.** Withdraw already let the author pull it back, but it made them resubmit and dropped the reviewer's place in the queue. Editing in place works like pushing to an open pull request. Anyone else who can contribute is still blocked once it is submitted (`can_edit_in_review`, enforced in `_assert_editable`).

## Tracer bullets

Each bullet is one PR against `develop`, with tests that fail on the old code.

1. **Explicit Edit, editor still everywhere.** Bootstrap stops creating, becomes a GET. Reading uses the existing read-only path. Edit button, Edit dialog, `?edit=1`, actions in Reading open the dialog. Patch for empty auto-created drafts. Agent skill docs if a method changes.
   - Unit: bootstrap creates nothing. Patch archives only empty drafts.
   - Playwright: opening a space and a page sends no write. Edit, name, type, save, submit, back to Reading. Rename in Reading opens the dialog first. `?edit=1` with and without a draft. A user who can merge sees Merge in Editing and lands back in Reading with the change live; a contributor does not see it.
   - Update `space-bootstrap`, `change-request-flow`, `local-first-store`, `contributions-disabled`, `spa-editor.mobile` specs that expect the auto-draft.
2. **Read mode HTML.** `get_page_html`, `WikiPageReader`, block scripts shared with the reader, async `WikiEditor`, prefetch on Edit hover.
   - Playwright: a Reading page view loads no editor chunk. Mermaid, PDF, code copy and images render. Read, Edit, type, save.
   - Pixel check of Reading against the public reader for the same page, light and dark.
   - Numbers before and after.
3. **Change requests in the space.** `changed_doc_keys` on `list_change_requests`, the header button and panel, then the page notice.
   - Unit: others' drafts are not listed. Counts match `diff_change_request`.
   - Playwright: user B's submitted change request shows for user A in the panel under "Changing this page", with its page notice. The panel and history replace each other in the right slot.
4. **Version history, read only.** History API, panel, page scope, diff. `source_commit` on Wiki Revision, set by git sync.
   - Unit: page history keeps only revisions that changed the page. A reader without space access gets 403.
   - Unit: a sync revision stores `source_commit`.
   - Playwright: merge two change requests on one page, the panel lists both, the diff shows the edit. A synced space's history shows "Synced from <commit>" and no Restore.
5. **Restore.** Restore a version and a deleted page through a change request. Space scope list.
   - Playwright: restore in Reading opens the dialog with "Restore <page>", merge brings the old content back.

## Prototype gaps

The combined prototype covers Reading, Editing and In review, the Edit dialog in front of Rename, New page and Restore, the change requests panel, the page notice and history. Still missing:

- Mobile: where the right panels go (bottom sheet or full screen) and where the header buttons fit.

## Not in scope

- Several drafts per user per space.
- Per-page versions and the operation log (3.1).
- Delta revisions (3.6). History reads full snapshots.

## Progress

### Part 1: Explicit Edit (2026-10-21)

Done:

- `get_space_bootstrap` is a GET and returns the user's open draft or `null`, through `get_editable_change_request`. A stale empty draft is skipped, not archived. `_is_stale_empty_draft` no longer writes `outdated`; `get_or_create_draft_change_request` does that itself.
- Patch `archive_empty_drafts` archives Draft change requests with no changes. On wiki.localhost it archived 73 and kept 127 with changes.
- `get_wiki_tree` returns each row's `doc_key` and the root's `root_key`, so the live tree and a draft's tree share row keys, expanded state and the create target. It is a GET too. A patch line drops the cached trees that lack `doc_key`.
- `get_edit_link` adds `?edit=1`.
- Space store: `isEditing`, `isReading`, `startEditing`, `stopEditing`. Reading and synced spaces show the live tree. The draft store no longer creates a change request; `ensureCr` only checks one is open.
- `StartEditingDialog` and `useStartEditing().requireEditing()`. It resolves after the dialog has closed, so the next dialog or the editor can take focus.
- Page header: Edit in Reading; Merge (users who can merge) and Submit for review in Editing. On mobile, Merge sits in the strip, since the header has no room.
- Page menu, tree row menus, the tree footer and New page from the command palette or the empty space all ask for a change request first. No drag in Reading.
- Strip: change request title (click to edit title and description), status, page count. Discard is offered with no changes too, as the way out of an Edit you did not need. Merge left the strip.
- Submit asks for a title when the draft still has a generated `Draft Changes - ` one.
- Merge and discard land in Reading. Merge reloads the open page first, so the viewer opens on merged content.
- A draft route outside Editing goes to the space.
- The read-only editor no longer reports content changes. It used to, on unmount, which marked the page dirty the moment Edit swapped it for the editor.

- The space's welcome view carries Submit and Merge while editing, since a change that is only an external link or a group opens no page.
- The live tree returns `is_external_link` and `external_url`. Before, read mode treated an external link as a page.
- Submit holds `finalizing` until the review page is up, or the draft route redirect raced it.
- After a merge the draft's tree stays on screen until the fresh live tree lands.
- The editor gets `autofocus` only when Edit asks for it. An explicit `autofocus: false` changes how TipTap starts and dropped the trailing paragraph after a table.

Tests: unit tests for bootstrap and the patch (the three new bootstrap tests fail on the old code). `e2e/tests/edit-flow.spec.ts` covers every Playwright case in the bullet. The specs that assumed the auto-draft now open a change request with `wiki.changeRequest(space)` or go through Edit (`editPage`, `startEditing`, `openNewPageDialog`).

Editing a change request in review (2026-10-24, decision 10): Edit on the review page, `can_edit_in_review`, Approved back to In Review on edit, `get_space_bootstrap(change_request=)`, the In review and Approved strip, Done editing. Unit tests for the backend rule and bootstrap fail on the old code. Playwright: a reviewer edits across a reload and finishes, an edit sends Approved back to In Review, an author who cannot merge edits without Merge.

Full suite on wiki.localhost: 204 passed, 46 failed, none from this change:

- 45 public reader pages time out on `networkidle`. `page_view.html` sends `make_view_log` with `keepalive: true`, and Chromium never reports a keepalive fetch as finished. Separate fix.
- `command-palette` "sets the theme named in the query" fails on develop too.

### Part 2: Read mode HTML (2026-10-22)

Done:

- `get_page_html(name)` is a GET. It checks read permission on the document, then returns the Redis-cached HTML with wiki links resolved, the `toc`, `modified` and `modified_by`. The outline ignores the reader's TOC setting, as the editor's does.
- The reader's content scripts are ES modules with one exported function each, taking the content root: `enhanceCodeBlocks`, `bindImageViewer`, `bindPdfEmbeds`, `renderMermaid`, and a new `bindThemeImages` for `<picture>` dark sources. `layout.html` imports them in one module script and exposes `wikiEnhanceContent` for the reader's client-side navigation. The image viewer builds its own overlay, so the markup left `layout.html`.
- `wiki/public/css/wiki-rendered.css` holds every content rule that was in `main.css`, scoped to `.wiki-rendered`. The reader's `#wiki-content` and the app's read mode both carry the class. The generated `frappe-ui-code.css` is scoped to `.wiki-rendered` too, so the app imports it without touching the editor.
- The reader's PDF modal is now `wiki-pdf-viewer*`. It shared `wiki-pdf-modal*` with the editor's `PdfViewerModal`, and their rules conflict (`display: none` against `flex`).
- `WikiPageReader` renders the HTML in the editor's layout, with the outline from `toc` (`EditorTableOfContents` takes `headings` when there is no editor). Links to pages in the space open in the app; other web links open in a new tab.
- `WikiDocumentPanel` fetches the HTML beside the document, not after it, cached per page. `WikiEditor` is an async import. Its chunk starts loading on Edit hover or focus, when the Edit dialog opens, and when the space is already in Editing.
- The rail and strip choice moved into `useOutlineLayout`, shared by the editor and the reader.

Measured on `perf-763510` (Administrator, 100 ms latency, median of 5, raw bytes since the local server does not gzip):

| | Before | After |
| --- | --- | --- |
| Time to article visible | 840 ms | 742 ms |
| JS loaded | 2,544 KB | 1,571 KB |
| `wiki-starterkit` + `WikiEditor` chunks | 997 KB | not loaded |

Fetching the HTML only once the document arrived was slower than before (933 ms), which is why the panel starts both requests together.

Pixel check, kitchen sink page (text, lists, tasks, quote, code, callouts, table, theme image with caption, mermaid, PDF):

- Public reader before and after this change: identical in light and dark.
- App read mode against the public reader at the same width: identical apart from antialiasing, with one difference that predates this change. `theme.css` dims every reader image in dark mode (`brightness(0.8) contrast(1.2)`); the app never has.

Tests: `TestGetPageHtml` (HTML and outline, unpublished page, outsider refused). `e2e/tests/read-mode.spec.ts`: a page view loads no editor chunk until Edit, code/image/PDF/mermaid behave as in the reader, the outline comes from the server, and a page link stays in the app. Updated `git-sync-readonly`, `git-sync-edit-on-github`, `command-palette` and `public-pdf-loading` for read mode and the renamed PDF viewer.

Full suite on wiki.localhost with view tracking off: 253 passed, 1 skipped, 1 failed. The failure is `command-palette` "sets the theme named in the query": the site has leftover "CR Preview Highlight" spaces, so "light" matches a space ranked above the Actions group.

Correction to Part 1's note: the `networkidle` timeouts are not the `keepalive` flag. With view tracking on and a signed-in user, `make_view_log` never reports finished to Playwright, even with `keepalive` off or the request fulfilled by a route. The server answers in 9 ms. Guests are not affected. Still a separate fix.
