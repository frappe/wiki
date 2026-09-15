# Cmd K Command Palette

Date: 2026-09-11
Date revised: 2026-09-15
Issue: https://github.com/frappe/wiki/issues/776
Status: **Built.**
Reference: Gameplan's palette, `gameplan/frontend/src/components/CommandPalette/`.

## Problem

The app searches within one surface at a time: **All Spaces** filters spaces,
and a space's sidebar filters that space's tree. Neither crosses a space
boundary, and neither has a keyboard shortcut. Finding "that page about
deploys" means guessing which space holds it and clicking into a box.

## Goal

⌘K (Ctrl+K off macOS) opens a palette that jumps to a page in any space you
can read, to a space, or to the app's own pages.

## Existing searches

The wiki already has three. The palette sits beside them and replaces none.

| # | Where | Stack | Scope | Matches |
|---|-------|-------|-------|---------|
| 1 | Reader modal, `wiki/templates/wiki/includes/search_modal.html` | Jinja + Alpine, guest | The current space, global elsewhere | SQLite FTS on content and title, published pages only |
| 2 | "Search spaces..." on Overview, `frontend/src/pages/Overview.vue` | Vue, client | The spaces list | Name filter over the visible grid |
| 3 | Space sidebar filter, `frontend/src/composables/useTreeSearch.js` | Vue, client fuzzy | One space's tree, already in memory | Title and slug, as a ranked list |

The reader modal already binds Cmd+K. It lives on the Jinja reader pages and
the palette lives in the Vue app, so the two never share a screen.

| | Reader Cmd+K | App Cmd+K |
|---|---|---|
| Job | Read the published docs | Go somewhere |
| Matches | Content and title, FTS | Page routes |
| Sees | Published only | Everything the user can read |

All three stay. The tree filter and spaces filter filter a visible list, which
is a different job from jumping. The reader modal is guest-facing, on another
stack, and full text. Converge on the look, not the code.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Page source | A new authenticated endpoint, `wiki.api.search.search_pages`, querying `Wiki Document` routes with `frappe.get_list`. The reader's SQLite index is not used: it holds only published pages, so drafts and unpublished spaces, which are exactly what an editor works on, would never show. `get_list` applies the existing `wiki_document_query_conditions`, so restricted spaces stay hidden with no new permission code. |
| 2 | What counts as a page | `is_group = 0`, `is_external_link = 0`, and a `wiki_space` set. Groups hold no content, external links leave the app, and the app only opens a page inside its space. Pages that exist only in an unmerged change request have no `Wiki Document` yet and are out of scope. |
| 3 | Matching | Route only, never the title. `route LIKE %/%query%` server-side once the query has 2 characters, with spaces in the query turned into hyphens, debounced 300ms, 20 rows, most recently modified first, with the space name and route joined in. The slash skips the space's own segment, which every page in it shares. The client re-ranks the page's path inside its space with `fuzzysort`, already a dependency, at a 0.5 cut as in the tree filter, so a prefix match beats a mid-word one. Rows are two lines, like the All Spaces list: the title, then the full `/route` in muted text, cut at the end when too long. Spaces and recents use the same second line for their route, and the eye-off icon sits at the right edge. Stale rows from an earlier query are re-ranked against the current one, so rows that no longer match drop out without tracking. |
| 4 | Local results | "Jump to" (All Spaces, Change Requests) and **Spaces** are matched on the client. Spaces are fetched once, on the palette's first open. Unpublished spaces show only to a Wiki Manager, as in the sidebar. |
| 5 | One sidebar entry | A **Search** row in `LibrarySidebar`, below Change Requests, with a `Mod+K` hint, as in Gameplan. It opens the palette. `SpaceSidebar` keeps its own tree filter and gets no row. Neither existing search box changes. |
| 6 | The editor keeps ⌘K where it means something | The editor binds `Mod-k` to its link popup, and `openLinkEditor` already returns `false` when nothing is selected and the cursor is not in a link. So the key falls through on its own, and the editor's keymap is unchanged. The palette registers with `allowInInput: true` (the editor is contenteditable) and `preventDefault: false`, and stands down on an event whose default was already prevented, which is exactly the case the editor handled. |
| 7 | Rendering | frappe-ui `Dialog` (`position="top"`, `bare`), a plain combobox input, a `role="listbox"` result list and `KeyboardShortcut` footer hints: Gameplan's structure, with its row metrics (`px-2 py-2`, `mr-3` icons) and 8px row corners. This frappe-ui has a numbered radius scale, so Gameplan's bare `rounded` generates no CSS here; the row uses `rounded-4`. Unpublished pages and spaces carry an eye-off icon. |
| 8 | Out of scope | Gameplan's command registry and its "Add new" / Settings groups, match highlighting, and a full-text results page. Mobile has no shortcut, so it has no palette. |
| 9 | The palette navigates, it does not search | It cuts clicks to a destination the user can already name. Full-text search stays with the reader. It would need a results page the app does not have, plus snippets, paging and ranking. And the SQLite index is published-only, so it has the wrong rows for the editor this palette serves. |
| 10 | Context biases, it never scopes | The same results everywhere. A page in the space the user is already in gets a `scoreScale` of 1.5, so it outranks the same title elsewhere without splitting the group. A palette scoped to the current space would rebuild search #3 behind a shortcut and fail the one case it exists for: a page in another space. No modes, so no destination is ever hidden. |
| 11 | An empty query | A **Recent** group: the last five pages *this user opened*, newest first, from `useRecentPages` (localStorage, like `usePinnedSpaces`), keyed by user so the next person in the same browser never sees titles they cannot read. `WikiDocumentPanel` records a visit once the page has a title. The page they are on is left out, because it is not somewhere to go. Visits store the space id and the route, and a row shows `/route` like a search result. A visit saved before routes were stored shows the space name until the page is opened again. |
| 12 | The active row | Tracked by item key, not list index, so a group that loads late cannot move the row a user is about to press Enter on. An unknown key falls back to the top row. |

## Phases

1. **API**: `wiki/api/search.py` plus integration tests.
2. **Palette**: ranking lib, open state, `CommandPalette.vue` in `MainLayout`.
3. **E2E**: `e2e/tests/command-palette.spec.ts`.
4. **Scope pass**: recents, context bias, stable active row (decisions 9 to 12).

## Tests

| Where | Count | Covers |
|-------|-------|--------|
| `wiki/api/test_search.py` | 8 | Route match with spaces as hyphens, title ignored, space segment ignored, space join, groups and external links excluded, unpublished included, restricted space hidden from an outsider and shown to a reader |
| `frontend/src/lib/commandPalette.test.js` | 8 | Empty-query groups, empty groups dropped, path match not title, spaced words against a hyphenated path, stale rows, server query length, current-space bias |
| `frontend/src/composables/useRecentPages.test.js` | 6 | Newest first, revisit moves to top, rename, cap of five, untitled ignored, per-user lists |
| `e2e/tests/command-palette.spec.ts` | 6 | Page in another space, space by name and Escape, opening from the sidebar Search row, recents without the current page, stable active row, shortcut shared with the link popup |

## Progress log

- 2026-09-12: **Built.** `search_titles` returns `space_name` and
  `space_route` through `get_list`'s link-field join. Six integration tests
  pass, and swapping `get_list` for `get_all` fails the outsider test, so the
  permission check is covered. The palette opens on ⌘K anywhere in the app,
  including from inside the editor, and the link popup still answers for a
  selection and for a cursor inside an existing link.
- 2026-09-12: Also fixed a pre-existing `delete` lint error in
  `MainLayout.vue` (the GitHub App query param is now dropped by destructuring).
- 2026-09-12: **Scope pass done.** Compared against Gameplan's palette, which
  has no context awareness at all. Added the `scoreScale` bias and key-based
  active-row tracking, plus a `recent_pages` endpoint.
- 2026-09-12: **Recents rewritten.** The endpoint ordered `Wiki Document` by
  `modified desc`, which is "recently edited by anyone", not "recently opened
  by you": it offered pages the user had never opened. Replaced with
  `useRecentPages`, a localStorage list written by `WikiDocumentPanel` when a
  page is opened. The endpoint and its four tests are gone.
- 2026-09-12: Fixed a bug the e2e found on the way: `LinkPopup.cancelEdit()`
  emitted `save` with an empty URL when backing out of a *new* link, and
  `WikiEditor` turned that into `setLink({ href: '' })`, wrapping the selection
  in a link with no href. Cancel now emits `cancel`, and an emptied box on an
  existing link emits `remove` instead of saving nothing.
- 2026-09-15: Folded `cmd_k_search_scope.md` into this spec (existing
  searches, decisions 9 and 10, considered and future ideas) and removed it.
- 2026-09-15: Review fixes from Greptile on #780. Recents used one
  localStorage key for every user, and localStorage outlives a logout, so a
  second user in the same browser saw the first user's page titles. The key now
  carries the user id, read from the `user_id` cookie through a helper shared
  with the session store. A whitespace-only URL in the link popup was checked
  before trimming, so it still saved an empty href; it now removes the link.
  The third finding, an unchecked `query` type, needed no change: Frappe
  validates the `str` annotation and rejects a list with `FrappeTypeError`.
- 2026-09-15: **Route only.** Pages now match on their route, not their title,
  and `search_titles` is renamed `search_pages`. A first pass matched title or
  slug; it was narrowed to the route on request. A page renamed after creation
  keeps its old route, because `set_route` runs only while `route` is empty, so
  it is found by the old words, not the new title. Checked in the browser:
  `release howto` finds "Deployment Guide" at `/<space>/release-howto`, and
  `deployment` finds nothing. A one-line row with the route on the right was dropped: truncation started each route at a different x, so the column was ragged, the eye-off icon floated mid-row, and cutting from the left hid the space, the one part that told duplicates apart. Also fixed the Restore icon in `WikiTree.vue`,
  which used `rotate-ccw` without the `lucide-` prefix and failed
  `icon-names.test.js`.
- 2026-09-16: **Sidebar entry.** Added a Search row with a `Mod+K` hint to
  `LibrarySidebar`, as in Gameplan, plus an e2e that clicks it.
- 2026-09-16: **Routes on recents.** Recent rows still showed the space name,
  because visits were stored without a route. `recordVisit` now stores the
  route, and the watcher in `WikiDocumentPanel` moved below `displayRoute`,
  which it reads immediately.

## Wrong turns worth recording

| # | What was tried | Why it was dropped |
|---|----------------|--------------------|
| 1 | A search button in the `SpaceSidebar` header | That column already has the tree filter, so a second search entry there is clutter. The `LibrarySidebar` row was dropped at first too, then added on request: ⌘K alone gave no hint that the palette exists. |
| 2 | ⌘K **focusing the existing search box** on screen instead of a palette | Neither box crosses a space, which is the thing that was missing. |
| 3 | Making the editor's `Mod-k` return `false` on an empty selection | Redundant: `openLinkEditor` already returns `false` there. Worse, it broke ⌘K on a cursor inside an existing link, which is how a link gets edited. Reverted, and the e2e now covers that case. |
| 4 | A `recent_pages` endpoint ordering `Wiki Document` by `modified desc` | That is the wiki's edit activity, not the user's history. It filled the palette with pages the user had never opened. Recents are per person and per browser, so they belong in localStorage, next to pins. |
| 5 | Context modes: spaces only on All Spaces, pages only inside a space | Hides the page in another space, which is the gap the feature closes. Replaced by the `scoreScale` bias. |
| 6 | Full-text search in the palette | See decision 9. |

## Considered, not taken

| # | Idea | Why not |
|---|------|---------|
| 1 | Split Pages under **In <space>** and **Other spaces** headers | `scoreScale` gets the same order with one group and no new UI. |
| 2 | Rank Spaces above Pages only on All Spaces | Spaces already rank above Pages everywhere. |
| 3 | A scope chip in the input (`Tab` pins the current space, `Backspace` drops it) | Additive and skippable. Build it when someone asks for a tight scope. |

## Deviations from Gameplan

| # | Gameplan | Here | Why |
|---|----------|------|-----|
| 1 | Rows show the hit's relative modified time | Page and recent rows show their `/route` | A page title repeats across spaces ("Getting Started" in four of them). The route starts with the space, so it tells them apart, and it is what the query matched. |
| 2 | Spaces are grouped per community | One Spaces group, each row labelled with its `/route` | The wiki has no community layer, and space names are not unique. |
| 3 | A command registry pages register actions into | No registry | Nothing registers commands yet. One implementation is not a framework. |
| 4 | A `Search for "<query>"` row into a full-text results page | No such row | Gameplan has a Search page to land on; the wiki does not, and its content index is published-only, so it would miss the drafts an editor lives in. |
| 5 | Nothing on an empty query beyond commands | A **Recent** group | A navigator should answer before a key is pressed. |
| 6 | `aliases` with a score penalty | Not taken | It suits a command registry. Space and page titles are the user's own words already. |
