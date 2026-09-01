# Information Architecture Refactor

Date: 2026-09-01
Status: **Planned.** Specs written, no implementation started.

Source of truth for the target design: the **`wiki-proto`** Sketch prototype
(https://sketch.netchamp.dev/u/nagariahussain/wiki-proto). Every spec in this
directory maps a slice of that prototype onto the real app. When a spec and the
prototype disagree, the spec wins — it records the decisions made while
reconciling the prototype with the real data model.

## The target IA in one paragraph

There is only ever **one navigation column**, and it drills. At the top level
(the "library") the sidebar lists the spaces with their identity tiles and
state icons, plus Overview / Search / Change Requests. Entering a space, the
sidebar **becomes the space**: back button, space identity, a mode strip
(git-synced or open-draft), tree search, and the document tree. The content
column keeps full width for the editor. The old layout — global static sidebar
+ `/spaces` list page + a second resizable tree column inside SpaceDetails —
collapses into this model.

## Specs, in build order

| # | Spec | What | Depends on |
|---|------|------|-----------|
| 1 | [01-sidebar-spaces.md](01-sidebar-spaces.md) | Spaces in the sidebar: LibrarySidebar + SpaceSidebar drill-in, route changes, retirement of the `/spaces` list page and the in-page tree column | — |
| 2 | [02-space-editor-revamp.md](02-space-editor-revamp.md) | Space details / editor page revamp: header row, page settings side panel, centered prose, floating outline, SettingsDialog-based space settings | 1 |
| 3 | [03-space-avatar.md](03-space-avatar.md) | Space identity: upload an image **or** generate abstract art (DiceBear, hive-style) | 1 (renders in the new sidebar) |
| 4 | [04-overview-analytics.md](04-overview-analytics.md) | Overview landing page with wiki-wide analytics, built like Frappe Builder's analytics | 1; **comes later** |

Each spec is its own feature branch and its own PR (`feat/ia-sidebar-spaces`,
etc.), branched off `upstream/develop`, spec committed first.

## Prototype → codebase map

| Prototype file | Real counterpart today | Fate |
|---|---|---|
| `App.vue` (one nav column + main) | `layouts/MainLayout.vue` + `components/Sidebar.vue` | MainLayout keeps shells/access/theme; Sidebar is replaced by the drill-in pair |
| `LibrarySidebar.vue` | `components/Sidebar.vue` + `components/SpaceList.vue` (page) | New component; SpaceList page retires (spec 1) |
| `SpaceSidebar.vue` | `components/SpaceTreePanel.vue` + `SpaceChromeBar.vue` + `ContributionBanner.vue` | New component; chrome bar and banner content move into the mode strip (spec 1) |
| `DocumentTree.vue` | `components/WikiDocumentList.vue` / `WikiTree.vue` | Kept — the real tree already handles DnD, CR overlays, dialogs. Restyle only |
| `PageContent.vue` | `components/WikiDocumentPanel.vue` + `WikiEditor.vue` | Revamp in place (spec 2) |
| `PageSettingsPanel.vue` | `components/PageSettings.vue` (dialog) | Becomes a right side panel (spec 2) |
| `SpaceSettingsDialog.vue` | `components/SpaceSettings/*` | Rebuilt on frappe-ui `SettingsDialog` (spec 2) |
| `Overview.vue` | — (no counterpart) | New page (spec 4) |
| `ChangeRequests.vue` | `pages/Contributions.vue` | Kept; regrouped by space later — out of scope for this program |
| — (no tabs in prototype) | `WikiTabBar.vue`, `useSpaceTabs.js`, `lib/spaceTabs.js`, reader `tabs.html` | Feature removed (spec 1) |
| space `icon`/`colour` stub fields | — (`Wiki Space` has only logos/favicon) | New identity fields (spec 3) |

## Program-level decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Rollout | Incremental, spec by spec. No long-lived "v4 layout" branch. Each PR leaves the app fully working. |
| 2 | Tabs (`enable_tabs`) | **Removed** (decided 2026-09-01). The drill-in sidebar shows the whole tree; tab groups render as ordinary top-level groups. App UI removal is part of spec 1; reader-side rendering and backend field deprecation are its final phase. `lib/tabIcons.js` survives — it is the curated lucide safelist behind IconPicker, not tab-specific. |
| 3 | Mobile | The drill-in model maps 1:1 onto the existing MobileShell drawers: library = Spaces tab, space sidebar = the existing tree drawer. No separate mobile design. |
| 4 | Overview timing | Spec 4 is written now but built last — it needs view tracking to accumulate data, so the tracking sub-phase (4.1) should merge early even though the page comes later. |

## Landmines (program-wide)

- **Public reader SPA DOM twins**: the Jinja templates and `sidebar.html`
  nav-store JS duplicate reader markup. This program touches only the **app**
  (`/wiki-app`); do not let sidebar restyling leak into the reader templates.
- **`Wiki Document` field whitelists**: ~40 explicit field enumerations in the
  CR/revision flow. Spec 3 adds fields to `Wiki Space` (safe), but any tree
  metadata added later (e.g. pinned order on nodes) hits the whitelists.
- **Lucide safelist**: DB-stored `lucide-*` classes render blank unless the
  literal appears in a scanned `.vue`. Space icon tiles reuse the curated
  picker lists that already act as the safelist.
- **Concurrent sessions** dirty this checkout; never stage by directory.
