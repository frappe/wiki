# Edit Flow: Explicit Edit, Change Requests in the Space, Version History

Date: 2026-10-21
Status: **Draft spec**. Takes over roadmap items 2.4 (create the draft on first edit, R13) and 2.8 (read mode HTML in the SPA, R10) in `pr-859-roadmap.md`, and issue [#622](https://github.com/frappe/wiki/issues/622) (version history UI).

Prototypes:

- **Final, all parts combined:** [wiki-edit-flow](https://sketch.netchamp.dev/u/gajjug004/wiki-edit-flow). Demo pills: Role (Contributor, Reader) and Change request (Reading, Editing, In review).
- Page header and change request warning: [wiki-page-header-and-change-request-notice](https://sketch.netchamp.dev/u/gajjug004/wiki-page-header-and-change-request-notice) (variant "header-only"). Supersedes the page notice in the combined prototype.
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
- Change request permissions (`wiki/permissions.py:263`): the hooks let any space reader read a change request in the space, but the Wiki User DocPerm has `if_owner`, so a plain contributor reads only their own. Approvers and managers read all of them. Any contributor can write one.
- Revisions: the main chain of a space is every revision with `is_working = 0`. A merge writes one with `is_merge = 1` and `change_request` set. Desk edits and live reorders write "Direct reorder" revisions with no change request. Most of them are overlays that hold only the pages they changed, with a full checkpoint now and then (`specs/delta_revisions.md`). Index: `(revision, doc_key)`.
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

**Change requests panel.** A "Change requests" button sits in the page header, beside the history button, in both states. It opens a panel on the right in the slot that history and page settings use (Part 4). The panel lists the space's open change requests in two groups: "Changing this page" first, then "Elsewhere in this space". When none touch the page, one group headed "In this space". Rows: title, author avatar, status badge, page count, updated time. A row opens the review page (`/change-requests/<name>`). Empty state: "No open change requests".

The button's count is the open change requests that change this page, with a dot when there are any. Its tooltip and label give the space total too: "2 open on this page, 3 in this space". A space-wide count beside a page-wide one read as a mismatch.

The sidebar stays for the page tree. No change requests section there.

Which change requests show:

- In Review, Changes Requested, Approved: everyone's.
- Draft: your own only. A draft is unfinished work and has no title worth reading until it is submitted.
- Merged, Rejected, Archived: no. History covers merged ones (Part 4).

Data: a new GET `list_open_change_requests(wiki_space)` returns the rows above, each with `changed_doc_keys` from the same summary `diff_change_request` builds (13.6 ms median on a 1,021-item space), and the author's name and image. The page count is its length. `list_change_requests` stays as it is: it lists every status, so a summary per row would cost a diff for every merged change request.

Permissions: a plain contributor (Wiki User) must be able to read others' submitted change requests for the panel to show them. Wiki User gets a second DocPerm row with `read` and no `if_owner`; write stays owner-only. The hooks hide Draft and Archived change requests from everyone but their author and managers. One call per space feeds the header count and panel groups: the SPA filters by the current `doc_key`, so there is no per-page endpoint. Open change requests per space are few, so N summaries per call is fine. 3.3 (change summary kept on write) makes it one query later.

**Page header.** Breadcrumbs, then "Open live page" as a small icon beside the title for a published page. On the right: Edit (subtle in Reading, since reading is the main task there), then change requests, history, page settings (a settings icon) and the page menu. Edit comes first so the main action in Reading is the first thing past the title. While editing, a divider sets Merge and Submit for review apart from the page tools: they act on the whole change request, not this page. The meta line under the title leaves out the view count while it is zero.

### Part 4: Version history (issue #622)

**Entry points.** A history button in the page header (both states) and the "Edited <time>" part of the meta line under the title. Both open the history panel on the right, where the page settings panel sits today. History, page settings and change requests (Part 3) share the slot, one at a time.

**Panel.** As in the prototype:

- Scope toggle: This page, Whole space.
- "Current version" at the top, then versions grouped by Today, Yesterday, This week, Earlier.
- Each row: author, "merged", "edited in Desk", "synced from <commit>" (decision 8) or "first version", then the change request title, time, and what changed (edited, renamed from X, moved, added, deleted, published, unpublished). Whole space shows the page count instead. Change request names are hashes, so the row shows the title, not "#<cr>".
- Selecting a version shows its diff in the main area with the review's `PageDiff` (`change_request_review.md`): Side by side, Inline, Markdown, "Show changes only". The bar above it links to the change request or the commit.

**Data.** New `wiki/api/history.py`, all GET, all check `can_read_space`. The main chain is read in `created_at` order, not by `parent_revision`: git sync writes its revisions with no parent. A new index on Wiki Revision `(wiki_space, created_at)` serves it.

- `get_page_history(wiki_space, doc_key, start, limit)`: main-chain revisions of the space joined to their item for `doc_key`, newest first. Keep a revision only where the item's `content_blob`, `title`, `route`, `is_published` or `is_deleted` differs from the previous kept one. Each version: revision, source (`merge`, `sync`, `desk`, `initial`), change request name and title, `source_commit`, author (name, image), `created_at`, changes, old title.
- `get_space_history(wiki_space, start, limit)`: main-chain revisions, newest first, with the number of pages each changed against the one before it (`_diff_revision_items`, as the review uses). A revision with the same tree and content hashes as the one before it is skipped: git sync takes a live snapshot first that changes nothing. The space's root group is not counted as a page the first version added.
- `get_revision_changes(revision, doc_key=None)`: every page the version changed against the previous main revision, or only `doc_key`, in the shape `get_change_request_review` returns, so `PageDiff` renders it. A working revision is refused: that is a change request, which has its own permissions.

Both lists return `{versions, more}`. These run as the session user. The revision doctypes stay manager-only: the API reads them with `frappe.qb` and `get_all` after the space check, like `get_cr_tree` reads overlay items.

Cost: a page's history query reads at most one row per main revision of the space through the `(revision, doc_key)` index. An overlay with no row for the page left it as it was. Paginate at 50. Measure on `perf-big-1000`.

**Restore.** Restore is a change request, never a direct write.

- Page scope, "Restore this version": in Editing, the content goes into the current draft as an `update_content` operation. In Reading, the Edit dialog opens with the title "Restore <page>" filled in, then the same operation runs.
- Deleted page, "Restore page": a `restore_node` operation if the doc_key is in the draft's base, else a `create_node` with the old content, title and parent.
- Space scope, "Revert changes" of a whole merge: later. It needs per-page three-way handling when pages changed again after that merge.

## Decisions

1. **Title first, not on submit.** The prototype had both variants. Start-first wins: Edit is the moment of intent, the title tells reviewers and other authors (Part 3) what is in flight from the start, and it removes the untitled drafts.
2. **One editable change request per user per space.** Same as today. The draft store, IndexedDB drafts and the strip all assume one current change request. Several parallel drafts per space is a separate feature.
3. **Read mode shows the live page, not the draft.** In Editing you see your draft in the editor. Reading never mixes in draft content, so it can use the cached HTML.
4. **Others' drafts stay hidden.** Only submitted work is public in the change requests panel. Submitted work is readable by every space reader, the review page included. Draft and Archived change requests are readable only by their author and managers.
5. **History is for space readers.** They can already read every page and every change request in the space.
6. **Change requests live in a page header panel, not the sidebar.** The prototype tried five placements: a sidebar section, sidebar tabs, a bottom tray, a popover in the space header and a popover beside history. A sidebar section pushed the page tree down. Tabs hid the tree. The tray and the popovers had no room to group by page. The panel reuses the right slot history already needs, keeps the tree whole, and has room for "Changing this page".
7. **Users who can merge get "Merge" beside "Submit for review".** For small fixes. Shown only when `_can_merge(space)` is true. It reuses `approveAndMergeChangeRequest`, which the strip already uses: submit, approve, merge. The change request still exists and keeps its title, so history shows "merged #<cr>" like any other merge.
8. **Git sync shows in history as "Synced from <commit>".** Sync writes a main-chain merge revision with no change request. A new `source_commit` field on Wiki Revision holds the commit sync applied (`head_sha` in `git_sync.py`). The row links to the commit on GitHub. Sync revisions written before this field show "Synced from Git". A synced space is read-only in the SPA, so its history has no Restore.
9. **History is SPA only.** The public reader gets no history link. Readers who want history open the space in the SPA.
10. **A change request in review stays editable for its author and for users who can merge.** Withdraw already let the author pull it back, but it made them resubmit and dropped the reviewer's place in the queue. Editing in place works like pushing to an open pull request. Anyone else who can contribute is still blocked once it is submitted (`can_edit_in_review`, enforced in `_assert_editable`).
11. **Open change requests show in the header only, not in a banner or the Edit dialog.** A bar under the header took a row on every page view, in amber, for readers who will never edit. A list in the Edit dialog put a second step between the author and the editor. The header count and its dot keep the open change requests visible, and the panel lists them.

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
3. **Change requests in the space.** `list_open_change_requests` with `changed_doc_keys`, the header button and panel, then the page notice.
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

### Part 3: Change requests in the space (2026-10-22)

Done:

- `list_open_change_requests(wiki_space)` is a GET. It returns everyone's In Review, Changes Requested and Approved change requests in the space, plus the user's own open draft, each with `changed_doc_keys`, `owner_name` and `owner_image`. A stale empty draft is left out, as in bootstrap.
- A plain contributor could not read anyone else's change request: the Wiki User DocPerm has `if_owner`. Wiki User now has a second row with `read` only, so submitted change requests open for every space reader, the review page included. Write stays owner-only. The hooks hide Draft and Archived change requests from everyone but their author and managers. Approvers lose sight of other people's drafts, which they had before.
- The page header has a Change requests button with the open count, in both states. Hidden on git-synced spaces.
- `ChangeRequestsPanel` groups the list into "Changing this page" and "Elsewhere in this space", or "In this space" when none touch the page. A row opens the review page. The list reloads when the panel opens and when the user's own change request starts, submits, merges or is discarded, once per action: a merge walks Draft, In Review, Approved and Merged, and reloading at each step sent 7 requests where 3 do.
- `PageChangeRequestsNotice` shows in Reading when open change requests change the page, with a menu to each. It hides while the panel is open.
- `usePageSettingsPanel` became `useSidePanel`: page settings and change requests share one slot, and history will join them.
- On a phone a side panel covers the page. Before, page settings squeezed the article into a 38 px strip.
- Page settings showed "From the repo" on every page in Reading, since Part 1 passes `readonly` there. It now shows only on a git-synced space.
- The status badge colours moved into `lib/changeRequestStatus.js`, replacing two copies.

Measured on `perf-big-1000` (1,021 items) with 5 open change requests, rolled back after: `list_open_change_requests` takes 58 ms median, 11.6 ms per change request.

Tests: `test_contributor_reads_submitted_change_requests_but_not_drafts` fails with either half of the permission change reverted. Two more unit tests cover the own draft, `changed_doc_keys` against `diff_change_request`, and an outsider. `e2e/tests/space-change-requests.spec.ts`: a contributor sees another user's submitted change request in the notice and under "Changing this page", not their draft, and opens its review page; the panel and page settings replace each other; on a phone the panel covers the page.

`edit-flow` and `contributions-disabled` counted every call to the change request module as a write; they now count only non-GET calls, since the panel reads the list on page load.

Related specs on wiki.localhost (`edit-flow`, `read-mode`, `change-request-flow`, `page-settings-meta`, `disable-indexing`, `spa-editor.mobile`, `mobile-view`, `contributions-disabled`, both git sync specs, `page-route-editable`): all pass. `mobile-view` needs view tracking off; the `networkidle` hang from Part 2 is still open.

Fixed in Part 1 while testing this: the Edit focus race. On a cold cache, `edit-flow` "a user who can merge" failed about 1 run in 6 to 8: typing right after Edit landed at the start of the page. The editor often mounts before the Edit dialog has finished closing, and with no autofocus asked for, TipTap still focuses it on mount, at the start. The move to the end only came once the dialog had gone. Edit now asks for the end before the dialog closes. "The editor takes focus with the caret at the end of the page" covers it; the merge test passed 8 cold runs in a row after.

### Part 4: Version history (2026-10-23)

Done:

- `wiki/api/history.py`: `get_page_history`, `get_space_history` and `get_revision_changes`, all GET and all behind `can_read_space`. The main chain is every revision that is neither working nor overlay, in `created_at` order; git sync writes its revisions with no parent, so `parent_revision` cannot be walked. A new index on Wiki Revision `(wiki_space, created_at)` serves it.
- Page history keeps a revision when the page's content, title, route, publish state or existence changed. Each version says how: added, deleted, renamed (with the old title), moved, edited, published, unpublished.
- Space history skips a revision with the same hashes as the one before it (git sync's live snapshot) and does not count the root group as a page the first version added.
- `get_revision_changes` diffs a version against the main revision before it, in the shape the review returns, so `PageDiff` renders it. It refuses working and overlay revisions: those are change requests, with their own permissions. The review's page builder became `rendered_changes`, shared by both.
- Wiki Revision has `source_commit`. Git sync sets it to the commit it applied.
- `HistoryPanel`: This page or Whole space, "Current version", versions grouped by Today, Yesterday, This week and Earlier. A row shows who, what kind of version (merged, edited in Desk, synced from <commit>, saved the first version), the change request title and what changed, or the page count for the space. "Show more" asks for a longer list.
- `VersionDiff` takes the main area while a version is selected: Side by side, Inline, Markdown and "Show changes only", the same switch as the review (`useDiffView`, shared now), and a link to the change request or the commit on GitHub.
- The page header has a history button in both states, git-synced spaces included. "Edited <time>" under the title opens the panel too.
- The page stays mounted under the diff (`v-show`), so a draft being typed keeps its unsaved text. The change request notice hides while a version is shown. Another panel, closing history or another page returns to the page. On a phone, picking a version closes the panel so the diff is visible.

Measured on `perf-big-1000` (1,021 items) with 60 merges added, rolled back after (81 main revisions):

| Call | Median of 5 |
| --- | --- |
| `get_page_history` (31 versions) | 1.4 ms |
| `get_space_history` (first 50 versions) | 368 ms |
| `get_revision_changes`, one page | 17.7 ms |
| `get_revision_changes`, whole version | 16.8 ms |

Space history costs about 3.5 ms per version at 1,021 items, half loading the two item maps, half diffing them (74 ms for the space's own 21 versions). It only loads when Whole space is picked. Keeping a change summary on write (3.3) makes it one query.

Fixed on the way: on a touch screen the code block's language label and copy button are always shown, and they covered the first line of code in read mode and the public reader. The toolbar now has its own row there.

Tests: `wiki/api/test_history.py` (6): page history keeps only revisions that changed the page, space history counts pages, pagination, the diff against the previous version, a working copy is refused, an outsider gets 403. `test_sync_revision_stores_source_commit` in `test_git_sync.py`. Both history tests that pin the fix fail with it reverted. `e2e/tests/version-history.spec.ts`: two merges on a page list in the panel and the other page's merge does not, the diff marks the edit and links to its change request, Whole space shows the other page; unsaved edits survive a trip to a version; a git sync row says "synced from abc1234", the rename, and links the commit. `read-mode` "the code toolbar sits above the code" fails on the old CSS. `git-sync-readonly` allows the history link under the title.

Related specs on wiki.localhost: `git-sync-readonly`, `git-sync-edit-on-github`, `change-request-review`, `change-request-flow`, `edit-flow`, `read-mode`, `space-change-requests`, `page-settings-meta`, `spa-editor.mobile`, `contributions-disabled`, `page-route-editable`, `disable-indexing`, `version-history`: 57 passed. `mobile-view`: 17 passed with view tracking off; the `networkidle` hang from Part 2 is still open.

### Page header and change requests (2026-10-26)

Done:

- The page notice is gone. Open change requests that change the page show in the header count and panel only. The Edit dialog does not list them.
- The Change requests button counts this page's open change requests, with a dot when there are any. Its tooltip and label read "2 open on this page, 3 in this space".
- "Open live page" moved from the toolbar to a small icon beside the breadcrumb title. Page settings has a settings icon. Edit is subtle in Reading and comes first among the header actions.
- The meta line leaves out "0 views in last 30 days".

Tests: `space-change-requests` checks the new button label, and that the Edit dialog stays clear while the panel lists the change requests. `analytics-dashboard` "the page's meta line leaves out a view count of zero" fails on the old code, which shows a zero count.

Fixed on the way: `command-palette` "shares the shortcut with the editor link popup" failed since Part 4. `getByRole('button', { name: 'Edit' })` also matched "Edited <time>" under the title. It now asks for the exact name.

Fixed on the way: after a change request was edited in review and then merged from its review page, the tree kept its change dots in Reading. The review page clears the change request but not its changes, and the tree marked them whatever the mode. The space store's `changeTypeMap` is now empty whenever the live tree shows. `edit-flow` "merging it from its review leaves no change marks on the tree" fails on the old code.

Related specs on wiki.localhost: `space-change-requests`, `edit-flow`, `version-history`, `page-settings-meta`, `contributions-disabled`, `disable-indexing`, the `analytics-dashboard` meta line tests and `command-palette` "shares the shortcut": 37 passed. Two of them hit a fixture deadlock with two workers and passed when rerun alone. `git-sync-readonly` "renders read-only" and two `analytics-dashboard` tests time out on `networkidle`, with and without this change: the hang from Part 2 is still open.
