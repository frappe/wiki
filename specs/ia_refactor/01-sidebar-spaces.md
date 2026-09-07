# Spaces in the Sidebar (drill-in navigation)

Date: 2026-09-01
Status: **Done.** All seven phases built.
Prototype: `wiki-proto` — `LibrarySidebar.vue`, `SpaceSidebar.vue`, `App.vue`.

## Problem

Navigation is split across three surfaces that don't compose: a global static
sidebar (two links), a full `/spaces` list page, and a second resizable tree
column inside SpaceDetails with its own header. Getting from "which spaces
exist" to "this page in this space" crosses all three, and the tree column
steals width from the editor.

## Goal

One navigation column that drills. Level 0 (**library**): spaces listed in the
sidebar itself, with identity tiles and per-state suffix icons, plus Overview /
Search / Change Requests items. Level 1 (**space**): the sidebar becomes the
space — back button, identity, mode strip, tree search, document tree, New
page. Content keeps full width.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Sidebar component | Keep frappe-ui `Sidebar`/`SidebarHeader`/`SidebarItem`/`SidebarSection` as in the prototype. Fixed 260px at level 1; the resizable-width composable (`useSidebarResize`) retires with the tree column. **No collapse toggle** (settled 2026-09-02, matching the prototype) — there is only one nav column now, so collapsing it leaves nothing to navigate with. |
| 2 | Space ordering | `switcher_order` (existing field), pinned spaces float to top in pin order. |
| 3 | Pinning | Per-user, stored in `localStorage` first (`wiki:pinned-spaces`). No backend field until someone asks for cross-device pins. Context-menu on the space row: Pin/Unpin, Space settings, Copy link. One shared `ContextMenu` for the whole list (prototype pattern — rows write the options on `@contextmenu`). |
| 4 | Suffix state icons | Independent icons, not one merged badge: `lucide-pin` (pinned), `lucide-folder-git-2` (git-synced), `lucide-lock` (has roles ⇒ restricted), `lucide-eye-off` (unpublished). Each with a Tooltip. |
| 5 | Identity tile | Until spec 3 lands: frappe-ui `Avatar` (square, `app_switcher_logo` image, initial fallback). Spec 3 swaps in the SpaceAvatar component. |
| 6 | `/spaces` list page | **Retires** (confirmed 2026-09-01). `/spaces` redirects to `/`. The list page's residual jobs move: create-space (incl. the GitHub repo flow) becomes a dialog opened from the sidebar's "New space" footer button; search/filter over spaces is served by the **Overview** page (reversed 2026-09-01 — the sidebar shipped a search box in phase 3 and it was removed again; the sidebar is a nav column, not a finder). The sidebar lists at most 15 spaces and, when there are more, ends the section with a `Show all spaces` row pointing at the Overview. |
| 6b | Unpublished spaces in the sidebar | A Wiki Manager sees them (marked with the eye-off icon) — they are that manager's own drafts, in the column they work in. Everyone else gets `is_published = 1`. The Overview is unfiltered either way, so nothing becomes unreachable. |
| 7 | Landing route `/` | Until spec 4 (Overview) ships: a minimal placeholder page ("pick a space") that also hosts the empty-wiki state and the New Space entry. The sidebar item "Overview" points at it from day one so the route name (`Overview`) never changes. |
| 8 | SpaceDetails layout | The `<aside>` tree column, `SpaceTreePanel` header, `SpaceChromeBar` and `ContributionBanner` placement all fold into `SpaceSidebar`. SpaceDetails keeps: the space document resource, router-view, settings dialogs. |
| 8b | Tabs removed | The horizontal tab feature goes away entirely (decided 2026-09-01). Tab-flagged groups render as ordinary top-level groups in the sidebar tree. App side: `WikiTabBar.vue`, `useSpaceTabs.js`, `lib/spaceTabs.js`, the tab bar row in SpaceDetails, "New Tab" tree actions, and the tab fields in space settings all go. Reader side: `templates/wiki/includes/tabs.html` and the tab logic in `mobile_header.html` / `sidebar.html` (both DOM twins). Backend: `is_tab`/`tab_icon` stay **in the schema** (Desk-hidden, ignored) so old CRs/revisions still apply — the ~40 `Wiki Document` field whitelists keep carrying them; actual field removal is a later cleanup with a migration. `enable_tabs`/`home_tab_title`/`home_tab_icon` on Wiki Space likewise hidden, not dropped. `lib/tabIcons.js` **stays** — it is the IconPicker's curated lucide safelist. |
| 9 | Mode strip | Directly under the space header, mutually exclusive: **git-synced** strip (`repo@branch`, sync status badge, Sync now, "Read-only · last synced …") or **open-draft** strip (CR title, pages-changed count, Submit / Discard, tinted by CR status). The full-width `SpaceChromeBar`/`ContributionBanner` retire; their actions (merge, withdraw, view live, settings) live in the strip and the space actions dropdown. |
| 10 | Tree search | TextInput above the tree filters in place; matching pages render as a **flat result list** (prototype pattern), not a pruned tree. Reuse `useTreeSearch` (already fuzzy). |
| 11 | Space header actions | Dropdown: Space settings, View live site, Switch space (→ `/`), Sync now (git only). Back button labeled "Overview". |
| 12 | Change Requests item | Suffix count = open CRs (status ≠ Merged/Rejected), from a lightweight count API. |
| 13 | Search sidebar item | Level 0 "Search" opens the existing search affordance if one exists; otherwise ships disabled-hidden until global search exists. Not this spec's job to build search. |
| 14 | Mobile | Library = existing `Spaces` mobile nav tab; space sidebar = existing `MobileDrawer` tree, which absorbs the mode strip. No new mobile chrome. |

## Current state (what exists)

- `layouts/MainLayout.vue` — Desktop/Mobile shells, access gate, theme,
  WikiSettings host. **Keeps all of that**; only the `#sidebar` slot content
  changes.
- `components/Sidebar.vue` — static two-item nav. Replaced by a router-driven
  switch: `SpaceSidebar` when `route.params.spaceId`, else `LibrarySidebar`
  (prototype `App.vue` pattern, `:key="spaceId"`).
- `components/SpaceList.vue` (911 lines) — list page + New Space dialog with
  the GitHub connect flow (installations, repos, branches). The dialog logic is
  the valuable part: extract to `components/NewSpaceDialog.vue` before deleting
  the page.
- `pages/SpaceDetails.vue` (966 lines) — owns chrome bar/banner, tab bar, tree
  aside, resize, mobile drawer, settings + clone + routes dialogs. Slims down
  to: resource + router-view + dialogs.
- Tab plumbing (to remove): `WikiTabBar.vue`, `useSpaceTabs.js`,
  `lib/spaceTabs.js`, tab branches in `WikiTree.vue`, `useTreeDialogs.js`
  (`DEFAULT_TAB_ICON` new-tab flow), `SpaceSettings/GeneralPanel.vue`,
  `stores/draftWorkspace*` and `stores/changeRequest.js` tab handling; reader
  `tabs.html`/`mobile_header.html`/`sidebar.html`; `is_tab` references in
  `wiki/api/wiki_space.py`, `wiki/wiki/llms_txt.py`, `wiki/wiki/git_sync.py`.
- `stores/changeRequest.js`, `stores/draftWorkspace.js` — CR mode and draft
  state the mode strip needs; already global stores.

## Phases

Tracer bullet first: get the drill-in switch rendering with the real space
list and the real tree before any state icons, pinning, or strip polish.

1. **Drill-in skeleton.** ✅ `LibrarySidebar.vue` (spaces via `useList` on Wiki
   Space: name, space_name, route, app_switcher_logo, is_published, git_synced,
   switcher_order + a roles-count annotation), `SpaceSidebar.vue` hosting the
   existing `WikiDocumentList` unchanged. MainLayout switches on route.
   SpaceDetails drops the aside. `/spaces` redirects; placeholder Overview
   page. **App must be fully usable at the end of this phase.**
2. **Mode strips + header actions.** ✅ Port ContributionBanner's submit /
   withdraw / merge and SpaceChromeBar's sync into the strip + dropdown;
   delete both components.
3. **Library affordances.** ✅ Suffix icons, pinning (localStorage + context
   menu), CR count suffix, New space footer button + extracted
   `NewSpaceDialog.vue`; delete `SpaceList.vue` and `pages/Spaces.vue`.
4. **Tree search-in-sidebar** ✅ (flat result list) + mobile reconciliation.
5. **Tab removal, app side.** ✅ Delete the tab bar row, `WikiTabBar.vue`,
   `useSpaceTabs.js`, `lib/spaceTabs.js`; tab groups now render as plain
   top-level groups; "New Tab" action and settings toggles removed. Whole
   tree always visible.
6. **Tab removal, reader + backend.** ✅ `tabs.html` retired;
   `mobile_header.html` and `sidebar.html` updated **together** (DOM twins);
   `is_tab` special-casing dropped from `wiki_document.py`, `wiki_space.py`
   API, `llms_txt.py`, `git_sync.py`. Doctype fields hidden, not dropped (see
   decision 8b).
7. **Cleanup.** ✅ Both named items landed early (`useSidebarResize` in phase
   1, the `/spaces` specs in phase 3), so this phase collects what the earlier
   ones deferred: the orphaned `WikiBreadcrumbs.vue`, the unreachable `isTab`
   create path, the two dead space-list endpoints, and the drill-in regression
   test the spec asked for and no phase wrote.

## Regression tests

- e2e: drill-in navigation (library → space → page → back), mode strip renders
  per space kind (plain / git / open-draft), submit-for-review from the strip.
- e2e: create space from sidebar dialog (plain; GitHub flow behind existing
  fixture if present).
- e2e: a space whose groups carry `is_tab` renders them as plain top-level
  groups in both app sidebar and published reader (tab removal regression).
- Unit: pin ordering (pin order beats switcher order, unpin restores).
- Local runs need `BASE_URL=http://wiki.localhost:8000`; long runs against the
  saturated local site should baseline against `upstream/develop`.

## Landmines

- **1847 spaces locally** — the library list must not fetch unbounded page
  size with avatars; paginate or cap + search.
- The reader (Jinja + `sidebar.html`) is off-limits **except** phase 6's tab
  removal — and there the TOC/nav markup is duplicated in Jinja AND the
  nav-store JS in `sidebar.html`; edit both or SPA nav shows stale UI.
- Tab fields ride the `Wiki Document` CR/revision whitelists (~40 explicit
  enumerations). Leaving the fields in place (decision 8b) means **no
  whitelist edits** — do not "clean them up" in this spec; that's the later
  schema-removal migration's job.
- Spaces with a merged CR history that reordered/flagged tabs must still
  render: treat `is_tab` as cosmetic-only everywhere, never as filter.
- `reka [hidden]` vs display utilities: any `hidden` gated by breakpoint on
  sidebar items needs `!hidden` or `data-[state]` gating (see memory).
- e2e helpers hardcode `APP_BASE`/routes (`e2e/helpers/routes.ts`) — the
  `/spaces` redirect must keep old deep links working.

## Open questions

- Does "Switch space" in the header dropdown earn its place vs just the back
  button? (Prototype has both.)

## Progress log

- 2026-09-07 — **Phase 7 done. The spec is complete.** Cleanup swept what
  phases 1–6 left behind rather than what the phase list named — both named
  items had already landed. `WikiBreadcrumbs.vue` (orphaned by phase 1's
  header, zero importers) is deleted; `createNode`'s `isTab` / `tabIcon`
  arguments are gone from `draftWorkspace.js` and `changeRequest.js`, since
  nothing has created a tab since phase 5; `get_space_count` and
  `get_space_stats` are deleted with their tests. The CR round trip is
  untouched — `treeModel.js` still normalizes and denormalizes both flags, so a
  year-old change request still merges. New `e2e/tests/sidebar-drill-in.spec.ts`
  covers the spec's first regression line. Reconciliation below.

- 2026-09-05 — **Phase 6 done. The reader has no tabs either.** The chrome is
  one row again: `tabs.html` is deleted, `layout.html` stops including it and
  stops stamping `data-wiki-tabs`, the navbar carries the bottom rule
  unconditionally, and `--wiki-chrome-h` loses its 97px branch. Both DOM twins
  render `nested_tree` whole. Backend: `get_space_tabs` and the synthetic Home
  tab are gone, the flags leave both tree builders and the page context,
  `llms.txt` is one section per space again, git-sync stops carrying the flags
  across a rebuild, and the five tab fields are hidden on their doctypes rather
  than dropped. `is_tab` / `tab_icon` still ride the CR and revision
  whitelists untouched — a merge of a year-old CR still applies. Verified in
  the browser on `erpnext-docs`, a real `enable_tabs` space: desktop and mobile
  both show one tree with all five top-level groups. Reconciliation below.

- 2026-09-02 — **Collapse toggle dropped.** `SidebarCollapseToggle` and the
  `is-sidebar-collapsed` storage key are gone; the footer strip now renders
  only for a Wiki Manager, so a reader gets no empty bordered rule under the
  list. Closes the open question.
- 2026-09-02 — **The sidebar stops being a directory.** It lists at most 15
  spaces and, only when there are more, ends with a `Show all spaces` row
  pointing at the Overview — the `Load more` footer is gone. It also drops
  unpublished spaces for everyone but a Wiki Manager (`useSpaceLibrary` takes
  `limit` and `publishedOnly`; the Overview passes neither and stays the full,
  unfiltered directory). Local dev data cleaned out at the same time: 1918 e2e
  fixture spaces deleted, leaving the 14 with real content, which is the shape
  a real wiki has.
- 2026-09-01 — **Phase 5 done.** The app has no tab bar: `WikiTabBar.vue`,
  `WikiTab.vue`, `useSpaceTabs.js` and `lib/spaceTabs.js` are deleted, the
  space store no longer derives tabs or a narrowed `visibleTreeData`, and the
  tree renders every top-level group at once. "New Tab", "Convert to tab",
  "Tab settings" and the Tabbed Navigation switch are gone with them. `is_tab`
  and `tab_icon` still ride the draft/CR model untouched — the reader keeps
  rendering tabs until phase 6.

- 2026-09-01 — **Library search removed from the sidebar.** The space filter
  box added in phase 3 is gone; `useSpaceLibrary` keeps `searchQuery` /
  `showSearch` for the Overview page, which is now the only place that
  searches spaces. The sidebar still pages 50 at a time behind `Load more`.
  (Superseded the next day — see below.)
- 2026-09-01 — Spec written from `wiki-proto`.
- 2026-09-01 — Decisions locked: tabs removed, /spaces retired, duckdb+pandas approved, avatar auto-roll on create.
- 2026-09-01 — **Phase 4 done.** Searching the tree now swaps it for a
  ranked flat list instead of pruning it in place, and the search box and a
  New page button moved out of the scroller into the panel's own header and
  footer — the mobile drawer renders the same panel, so it picks both up.
  Reconciliations below.

- 2026-09-01 — **Phase 3 done.** The library rows carry their four state
  icons, a shared `ContextMenu` (pin / space settings / copy link), a
  server-side search and a New Space footer button; `NewSpaceDialog.vue` is
  extracted and `SpaceList.vue` (911 lines) is deleted. Pins live in
  `composables/usePinnedSpaces.js` (localStorage, unit-tested); the paged list,
  search and pin order live in `composables/useSpaceLibrary.js`, shared by the
  sidebar and the Overview page. Reconciliations below.

- 2026-09-01 — **Layout fix on top of phase 2.** The app frame now clips
  (`overflow-hidden` on the MainLayout root) and the open page owns the only
  scroller in the content column, a frappe-ui `ScrollArea`. Before this the
  document itself scrolled — frappe-ui `Tree`'s absolutely-positioned aria-live
  region resolved against the page and added 196px — so the whole chrome slid
  with the editor, and SpaceDetails wrapped the page in a second scroller. The
  bubble menu now takes that ScrollArea as its `scrollTarget`, so it tracks the
  editor's scroll and hides with the selection instead of parking mid-page
  looking like a second toolbar; the outline rail sizes to the container rather
  than `100vh`.
- 2026-09-01 — **Phase 2 done.** `SpaceModeStrip.vue` renders both strips
  under the sidebar header; `SpaceChromeBar.vue` and `ContributionBanner.vue`
  deleted; submit / discard / merge extracted to
  `composables/useChangeRequestActions.js`. Reconciliations below.
- 2026-09-01 — **Phase 1 done.** `LibrarySidebar.vue` + `SpaceSidebar.vue`,
  MainLayout switches on `route.params.spaceId`, SpaceDetails lost its `<aside>`,
  `/spaces` redirects to the new `Overview` route. Reconciliations below.

### Phase 7 reconciliation

| # | Spec said | Build does | Why |
|---|-----------|-----------|-----|
| 1 | Phase 7 — `useSidebarResize` retires | Already deleted in phase 1 | Its only consumer was the `<aside>` phase 1 removed; leaving a dead composable in the tree for six phases was the worse option. |
| 2 | Phase 7 — e2e specs that navigated via `/spaces` updated | Already done in phases 3–5 | Each phase rewrote the specs it broke in the same commit, which is the only way the suite stays green phase to phase. Nothing was left for this one. |
| 3 | Phase 3 item 8 — `get_space_stats` / `get_space_count` left for spec 4 | **Deleted**, with their two test classes | The assumption did not survive reading spec 4: its API surface is a new `wiki.api.analytics` module (`get_overview`, `get_top_searches`, `get_needs_attention`), not per-space list columns. Both endpoints backed the retired list page's row stats and result tally, and `get_space_count`'s search/published filters exist only to match that page's filter bar. Keeping whitelisted endpoints alive for a consumer that will not call them is public surface with no owner. |
| 4 | Phase 5 item 5 — `createNode`'s `isTab` argument "unreachable but harmless; phase 6 decides" | Removed from the create path in both stores | Phase 6 did not decide it, so it lands here. No caller passes it, the tab-creation UI is gone, and a new node is never a tab — the parameter only invited a future reader to think tabs were still creatable. The backend `create_cr_item(is_tab=False)` default covers the wire. |
| 5 | Decision 8b — the flags survive the CR round trip | `treeModel.js` normalize/denormalize untouched; `applyServerFields`'s two branches removed | Serialization is the round trip and stays. `applyServerFields` is the *update* path, and no component has sent `is_tab` or `tab_icon` in an update since phase 5 — those two lines guarded a field nothing writes. No `Wiki Document` whitelist was touched, per the landmine. |
| 6 | — | `WikiBreadcrumbs.vue` deleted | Orphaned by phase 1, when the sidebar header took over identity. It was the only frontend caller of the whitelisted `get_breadcrumbs`, which now has none — flagged rather than removed, because `specs/cleanup/003` already owns that endpoint's authorization gap. |
| 7 | Regression tests — e2e drill-in navigation | `e2e/tests/sidebar-drill-in.spec.ts`, new | The one line of the spec's own regression list no phase had written. Mode strip and create-space are covered incidentally (`change-request-flow` drives Submit/Merge from the strip, `git-sync-readonly` covers git mode, and eight specs open the sidebar's New Space dialog), so this adds only the missing one. |
| 8 | — | The spec is built with two spaces, not one | The load-bearing assertion is negative: inside space A, space B's row is gone. One space would pass even if the library list were appended to rather than replaced. Both space rows and the back button are scoped to `[data-slot="sidebar"]` — the Overview page in the content column lists the same spaces, so an unscoped `href` locator matches twice and asserts nothing about which column owns the row. This was a real failure on the first run, not a precaution. |

### Phase 6 reconciliation

| # | Spec said | Build does | Why |
|---|-----------|-----------|-----|
| 1 | Retire `tabs.html`, update the two DOM twins | `layout.html`, `header.html` and `main.css` change too | The tab row was a full-width chrome row, so removing it is a layout change, not just a delete: the include and the `data-wiki-tabs` body attribute go, the navbar's bottom rule stops being conditional (it now always ends the chrome), and `--wiki-chrome-h` drops the 97px branch. |
| 2 | `is_tab` special-casing dropped from `wiki_space.py` API, `llms_txt.py`, `git_sync.py` | `wiki_document.py` too | That is where the tab API actually lived: `get_space_tabs`, `_home_tab_entry`, `_tab_landing_route`, `WIKI_HOME_TAB_KEY` and the `space_tabs` render-context key are all gone, and `build_nested_wiki_tree` stops selecting the flags. |
| 3 | — | `WikiDocument.validate_tab` deleted, and `is_top_level_group` with it | A validator that throws is not a cosmetic-only field: it would have rejected an old revision that carries the flag on a nested group. Removing the reorder guard left `is_top_level_group` with no callers. |
| 4 | — | `_build_wiki_tree_for_api` drops the flags | The app tree has no use for them since phase 5; leaving them in the payload only invited a new reader of a dead field. |
| 5 | Doctype fields hidden, not dropped | Hidden, `depends_on` removed, descriptions rewritten to say deprecated | A `depends_on` on a hidden field is dead weight, and the old descriptions still described a feature that no longer exists. Both doctype JSONs keep frappe's own formatting (tabs for `Wiki Document`, one-space for `Wiki Space`, no trailing newline on the latter). |
| 6 | — | The clone path in `wiki/wiki/doctype/wiki_space/wiki_space.py` still copies the flags | A clone mirrors its source's stored data, and the fields are still in the schema. Nothing reads them, so this is fidelity, not a live feature. |
| 7 | — | The mobile drawer's `filterTree` is simplified | It walked `root.children` and skipped `display:none` subtrees — machinery that existed only because tabs hid subtrees in the DOM. With one tree it is a flat `querySelectorAll`. |
| 8 | Phase 7 — e2e specs asserting the tab bar get updated | `tab-navigation.spec.ts` → `stale-tab-flags.spec.ts` | The reader tests it carried drove a bar that no longer exists. The suite is rebuilt around the spec's own regression: one space carrying `enable_tabs` + `is_tab` + `tab_icon` renders as one plain tree in the reader (desktop and mobile drawer) and in the app, with no `tablist` anywhere and the navbar sitting directly above the tree. |
| 9 | — | `TestTabValidation` + `TestGetSpaceTabs` (20 tests) replaced by `TestStaleTabFlags` (3) | Those tested a feature, not a regression. What is worth holding is that a flagged group saves anywhere, reorders anywhere, and never reaches the public tree. The `llms.txt` fixture now carries a stale `is_tab` flag and asserts a single section, which is the same guarantee on the index. |

### Phase 5 reconciliation

| # | Spec said | Build does | Why |
|---|-----------|-----------|-----|
| 1 | Delete the bar, `useSpaceTabs.js`, `lib/spaceTabs.js` | `WikiTab.vue` deleted too | It was the bar's row component and had no other consumer. |
| 2 | — | `spaceRootNode` retires from the tree prop chain | Its only job was parenting a new tab away from the browsed subtree. With no subtree narrowing, `rootNode` *is* the space root, so `useTreeDialogs` takes that instead and three components drop a prop. |
| 3 | — | `WikiTree`'s `is_tab` drag guard and `isTopLevel` go | The guard existed to keep a tab top-level. Nothing is top-level-only any more, and `isTopLevel` had no other caller. |
| 4 | — | `SpaceIcon` no longer renders in the tree | Its one use was the tab row's icon; groups get the folder icon like any other group. The component and `lib/tabIcons.js` stay for IconPicker (and spec 3's identity picker). |
| 5 | Decision 8b — fields stay | `draftWorkspace`, `treeModel` and `changeRequest` untouched | They only carry `is_tab`/`tab_icon` through the CR round trip. Stripping them would drop the flag on a merge while the reader still reads it. `createNode`'s `isTab` argument is now unreachable but harmless; phase 6 decides its fate. |
| 6 | Phase 7 — e2e specs that asserted the tab bar get updated | `tab-navigation.spec.ts` rewritten now | Four editor-side tests drove a bar that no longer exists. They are replaced by one app-side regression test (an `enable_tabs` space renders its `is_tab` groups as plain top-level rows, no `tablist`), which is the spec's own tab-removal regression. The reader tests stay — the reader still has tabs until phase 6. |

Verified in the browser at 1440×900 on a real `enable_tabs` space: five
top-level groups in one tree, no tab bar, the add menu offers only New Group /
External Link, and Space settings → General has no Tabbed Navigation row.

### Phase 4 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 10 — reuse `useTreeSearch` (already fuzzy) | Reused, but its prune/keep/expand core is replaced by a rank-ordered `matches` list | Pruning was what forced the tree to fake its expand state; with a flat list `WikiTree`'s `expandedOverride` prop has no job and retires with it. The thresholds, highlight segments and their tests are untouched. |
| 2 | Prototype filters the result list to pages | Groups and external links stay results | Dropping groups would leave no way to find one by name. A group has nothing to open in place, so picking one clears the query and expands it back in the tree. |
| 3 | Prototype puts the search box in `SpaceSidebar` | It lives in `WikiDocumentList`, above that component's own scroller | The mobile drawer renders the same panel (decision 14), so a sidebar-level search box would have needed a second copy and a lifted query. One owner covers both surfaces, and phase 4's mobile reconciliation is then free. |
| 4 | Prototype footer is a single `New page` button | `New page` plus a chevron dropdown for Group / External Link / Tab | The tree still needs those three entry points until phase 5 drops the tab one. The old `Add` plus-dropdown and the empty state's `Create First Page` CTA both retire into this footer, which renders whether or not the space has pages. |
| 5 | — | While searching, every result row shows its route, not just route-only matches | A flat row has no ancestors to place it, so the route is the only thing left saying where the page lives. |
| 6 | Phase 7 — e2e specs get updated | `tree-search.spec.ts` rewritten for flat results now; `clickSidebarAddOption` / `openNewPageDialog` rewritten around the footer button | Both helpers hung off affordances this phase removed, so ~8 specs would have failed on the old locators. `git-sync-readonly` asserts on the absent `New page` button instead of `button[title="Add"]`. |

Verified in the browser at 1440×900 and 390×844: the search box and New page
footer hold their positions while the tree scrolls between them, a query
renders matches as a flat list with title and route both highlighted, clicking
a matched group clears the query and opens that group in the tree, and the
mobile drawer shows the same header, list and footer. Unit suite 74 pass; lint
and build pass. E2E was not run — the local site is saturated (see the
landmines).

### Phase 1 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Branch off `upstream/develop` | Built on `feat/frappe-ui-beta55` | develop pins frappe-ui `1.0.0-beta.25`; the drill-in sidebar needs beta55's `Sidebar`/`SidebarSection`/`useList`. The IA program is stacked on the upgrade branch. |
| 2 | Decision 8 — SpaceDetails keeps the space document resource | New `stores/space.js` owns the document, the tree, tabs and git sync | The sidebar is a *sibling* of the page, not a descendant, so the two columns need an owner above them both. SpaceDetails still mounts the dialogs and drives CR submit/merge/withdraw. |
| 3 | Phase 1 fetches a roles-count annotation | Not fetched yet | The lock suffix icon that consumes it is phase 3; fetching a child table per row on a 1847-space site with nothing rendering it is pure cost. |
| 4 | Decision 2 — order by `switcher_order` | `switcher_order asc, creation desc` | `switcher_order` defaults to 0 for every space, so on its own it leaves the newest space in an arbitrary slot. Creation breaks the tie the way the old list page did. |
| 5 | Decision 7 — Overview is a minimal "pick a space" placeholder | Overview renders the existing `SpaceList` for now | It is still the only way to create a space, and the only space list on mobile. It becomes the real placeholder in phase 3, alongside the extracted `NewSpaceDialog`. |
| 6 | Decision 11 — header dropdown includes "Switch space" | Omitted | The back button already does it (the spec's own open question). Add it back if the sidebar ever stops showing one. |
| 7 | Phase 7 — `useSidebarResize` retires | Deleted now | Its only consumer was the `<aside>` this phase removed. |
| 8 | Phase 2 — `SpaceChromeBar` retires with the mode strip | Its identity block (back, name, view live, settings) already removed | The sidebar header renders identity now, so leaving it in the bar showed the space name and a back button twice on desktop. The bar keeps badge / meta / actions until phase 2 deletes it. |

Phase 1 also caps the library list at 50 spaces with a `Load more` footer
(landmine: 1847 spaces locally). Search over the list arrives in phase 3.
(Both superseded — see the 2026-09-02 log entry: the cap is 15 and the footer
is a link to the Overview.)

Not verified in a browser: the local bench returns 500 for every site on it,
including ones unrelated to the wiki, so the app could not be loaded. The build
and lint pass; the drill-in needs a live check once the bench is back.

### Phase 2 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Prototype strip: `Submit` and `Discard` side by side | `Submit for Review` full-width; `Discard Changes` in the strip's ⋯ menu | The label is the handle ~15 e2e specs grab (`getByRole('button', { name: 'Submit for Review' })`), and discard is destructive — it stays one level down, as it was in the banner. |
| 2 | Decision 14 — the mobile tree drawer absorbs the mode strip | Mobile renders the strip inline above the content; the sidebar renders it on desktop | The drawer is closed by default and closes again on page open, so submit / merge / sync would be unreachable without first opening the tree. One instance either way (`v-if="isMobile"` in SpaceDetails, plain in SpaceSidebar). |
| 3 | Decision 9 — the strip carries the actions | The actions themselves moved to `composables/useChangeRequestActions.js` | The strip is a *sibling* of SpaceDetails, so it cannot receive `@submit`/`@merge` handlers as events. SpaceDetails keeps only the dialogs and auto-open logic (966 → 435 lines across both phases). |
| 4 | ContributionBanner took a `mergeDisabled` prop from the page | The strip reads `spaceStore.isTreeReordering` directly | Same reason — no parent to pass it. |
| 5 | Decision 9 — git strip shows a sync status badge | Badge is now themed by status (`Success` green, `Error` red, `Partial` amber), and the strip gained the prototype's `Read-only · last synced …` line from `last_sync_time` | The old bar hardcoded `theme="gray"`, which made a failed sync look like a healthy one. |

Verified in the browser (the bench's 500 was a missing `Dock` doctype, fixed by
`bench migrate`): the git strip renders `repo@branch` with a themed status badge
and the read-only line, the draft strip counts changed pages and drives the
submit dialog, the ⋯ menu offers View changes / Discard Changes, and discard
clears the draft. Unit suite (`node --test "src/**/*.test.js"`) 67 pass; lint
and build pass. E2E was not run — the local site is saturated (see the
landmines).

Two things the browser pass turned up:

- **The app did not mount at all.** `useChangeTypeDisplay` calls `__()` at
  module scope, which was harmless while it only loaded in a lazy route chunk;
  the strip pulls it into the eager sidebar chunk, ahead of the translation
  global. Fixed by making the labels functions, with a regression test.
- **"Unsaved changes" survives a discard.** After Discard Changes — and across a
  reload — the sync pill still reports unsaved editor content: a page buffer
  whose `localContent` diverges outlives the change request it belonged to.
  Pre-existing (the discard path is carried over verbatim from
  ContributionBanner), so it is logged here rather than fixed in this phase.

### Phase 3 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 4 — `lucide-lock` means "has roles ⇒ restricted" | Restricted means role rows **without** `Guest` | Every space created through the dialog gets a `Guest`/Read row, so "has roles" would have locked the whole list. This matches `wiki.permissions.can_read_space`: no rows is open to logged-in users, a Guest row is public. New endpoint `get_restricted_spaces(spaces)` — one grouped query per page of spaces, not a child table per row. |
| 2 | Phase 1 fetches a roles-count annotation | Still not a list field | Same reason as phase 1: it is a child table. The flag comes back from its own endpoint alongside the page. |
| 3 | Decision 6 — search over spaces is served by the sidebar list | Shipped here, not in phase 1 | Deleting the list page removed the only space search, so it had to land in the same phase. Server-side `space_name like`, debounced 250 ms, and the row only appears once the list is ≥10 long. |
| 4 | Decision 7 — Overview is a minimal "pick a space" placeholder | Overview is a lean space list (~170 lines, no stats columns, no filter tabs) | It is still the only space list on **mobile**, where the sidebar it would defer to does not exist (decision 14). The old page's per-row stats and published filter did not survive. |
| 5 | Decision 6 — New space is the sidebar footer button | Desktop: sidebar only. Mobile: the Overview header | Two `New Space` buttons a few inches apart on the same screen read as a duplicate, and Playwright's role lookup matched both. The desktop empty-wiki state points at the sidebar rather than repeating the button. |
| 6 | — | `useList` needs a manual paging reset on search | A fetch from a non-zero `start` *appends*, and `start` is exposed readonly with no reset, so a new search would have stacked its results on the last one's. `previous()` is walked back to 0. |
| 7 | Phase 7 — e2e specs that navigated via `/spaces` get updated | `e2e/tests/space-list.spec.ts` deleted now | Its whole subject was the list page's row-level `View` button, which retires with the page. The other specs still find `New Space` (the sidebar's) and space links unchanged. |
| 8 | — | `get_space_stats` / `get_space_count` now have no callers | Left in place rather than deleted: spec 4's Overview analytics is the obvious consumer for both. Phase 7 decides. |

Verified in the browser at 1440×900 and 390×844: the four suffix icons each
render on a space that has that state (pin, `folder-git-2`, `lock`, `eye-off`),
right-click opens one shared menu, Pin to top floats the space to the top of
**both** the sidebar and Overview (shared localStorage) and writes
`wiki:pinned-spaces`, Space settings navigates into the space and opens the
dialog, search filters server-side, and the New Space dialog creates a space and
drills into it. Unit suite 73 pass; `wiki.test_api` 37 pass (6 new, checked by
temp-reverting the Guest rule); lint and build pass. E2E was not run — the local
site is saturated (see the landmines).

### Follow-up: the tree's state marks

2026-09-07. Decision 4 settled the *space* list on independent icons rather
than badges, but the document tree kept seven text badges of its own — New,
Modified, Deleted, Reordered, Not Published, Syncing…, Sync failed — one per
row. At a real space that is a column of coloured labels with page titles
squeezed behind them, which is the thing decision 4 was avoiding.

| # | What shipped | Why |
|---|--------------|-----|
| 1 | Change types become a 6px dot, coloured by type, carrying the old label as `title` and `aria-label` | The tree is a navigation column. Which pages changed is a glance question; which *kind* of change is a hover question |
| 2 | `Not Published` becomes `lucide-eye-off` | The same icon decision 4 gave an unpublished space. Unpublished is not a change, so it is not a dot |
| 3 | `Syncing…` becomes a gray dot; **`Sync failed` keeps its red badge** | A failed save is the one state that asks the user to do something, and it has to stand out against the dots rather than join them |
| 4 | The colours moved into `useChangeTypeDisplay` as `getChangeDotClass` | The tree had hardcoded its own, and had drifted: `added` was drawn blue there and green everywhere else. One place owns the mapping now, and `added` is green |
| 5 | The outline rail's wrapper became a `div` | It was an `<aside>`, and once spec 02 phase 6 brought the rail back at 1280 there were two complementary landmarks on the page — which made `locator('aside')`, the sidebar in 72 e2e specs, ambiguous. The nav inside it was already the landmark |

Verified at 1440×900: a space with new, modified and reordered pages shows one
dot per row and full-width titles. `change-request-flow`'s reorder case reads
the dot's label instead of the badge text — 2/2 pass; `editor-toc` unchanged at
5/6 (the pre-existing scroll-spy failure). Unit suite 82 pass (81 + 1 for the
dot classes); lint and build pass.
