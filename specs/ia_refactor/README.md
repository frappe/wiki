# Information Architecture Refactor

Date: 2026-09-01
Date revised: 2026-09-08
Status: **In progress.** Spec 1 is built (all seven phases) and spec 2 is built
(all six, including the alignment pass against the prototype); specs 3–5 are
written and unstarted. The former spec 4 (Overview + analytics) was split on
2026-09-08 into page views (4) and search (5).

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
| 1 ✅ | [01-sidebar-spaces.md](01-sidebar-spaces.md) | Spaces in the sidebar: LibrarySidebar + SpaceSidebar drill-in, route changes, retirement of the `/spaces` list page and the in-page tree column | — |
| 2 ✅ | [02-space-editor-revamp.md](02-space-editor-revamp.md) | Space details / editor page revamp: header row, page settings side panel, centered prose, floating outline, SettingsDialog-based space settings | 1 |
| 3 | [03-space-avatar.md](03-space-avatar.md) | Space identity: upload an image **or** generate abstract art (DiceBear, hive-style) | 1 (renders in the new sidebar) |
| 4 | [04-overview-page-views.md](04-overview-page-views.md) | Overview landing page: view tracking, KPI strip, views-over-time, views-by-space, top pages, needs-attention | 1; **comes later** |
| 5 | [05-search-analytics.md](05-search-analytics.md) | `Wiki Search Log`, click events, and the search sections of Overview — counting modelled on Algolia | 4 (uses its page shell) |

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
| `Overview.vue` | `pages/Overview.vue` (spec 01 placeholder) | Filled in by spec 4; keeps the placeholder's empty-wiki state and mobile space list |
| `ChangeRequests.vue` | `pages/Contributions.vue` | Kept; regrouped by space later — out of scope for this program |
| — (no tabs in prototype) | `WikiTabBar.vue`, `useSpaceTabs.js`, `lib/spaceTabs.js`, reader `tabs.html` | Feature removed (spec 1) |
| space `icon`/`colour` stub fields | — (`Wiki Space` has only logos/favicon) | New identity fields (spec 3) |

## Program-level decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Rollout | Incremental, spec by spec. No long-lived "v4 layout" branch. Each PR leaves the app fully working. |
| 2 | Tabs (`enable_tabs`) | **Removed** (decided 2026-09-01). The drill-in sidebar shows the whole tree; tab groups render as ordinary top-level groups. App UI removal is part of spec 1; reader-side rendering and backend field deprecation are its final phase. `lib/tabIcons.js` survives — it is the curated lucide safelist behind IconPicker, not tab-specific. |
| 3 | Mobile | The drill-in model maps 1:1 onto the existing MobileShell drawers: library = Spaces tab, space sidebar = the existing tree drawer. No separate mobile design. |
| 4 | Overview timing | Specs 4 and 5 are written now but built last — both need logged data to accumulate, so their tracking phases (4.1, 5.1) should merge early even though the pages come later. |
| 5 | Analytics engine | **Revised 2026-09-08.** MariaDB first, keeping Frappe Builder's API shape; port its DuckDB module only against a measured need. This reverses the 2026-09-01 approval of `duckdb` + `pandas` — see spec 4, decision 10. **Needs sign-off before phase 2.** |

## Landmines (program-wide)

- **Public reader SPA DOM twins**: the Jinja templates and `sidebar.html`
  nav-store JS duplicate reader markup. Specs 1-3 touch only the **app**
  (`/wiki-app`) — do not let sidebar restyling leak into the reader templates.
  Specs 4-5 are the deliberate exception: view and search logging must fire from
  the reader, and the JS half of the twin is where a SPA navigation is
  observable at all.
- **`Wiki Document` field whitelists**: ~40 explicit field enumerations in the
  CR/revision flow. Spec 3 adds fields to `Wiki Space` (safe), but any tree
  metadata added later (e.g. pinned order on nodes) hits the whitelists.
- **Lucide safelist**: DB-stored `lucide-*` classes render blank unless the
  literal appears in a scanned `.vue`. Space icon tiles reuse the curated
  picker lists that already act as the safelist.
- **Concurrent sessions** dirty this checkout; never stage by directory.
