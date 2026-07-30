# Per-Space Tab Navigation Toggle

Date: 2026-07-30
Status: **In progress.** See [Progress log](#progress-log) at the bottom.

## Problem

Horizontal tab navigation (see `horizontal_tab_navigation.md`) is currently
unconditional. Every space shows the tab row, because the editor's bar always
renders a synthetic **Home** entry even when the space has no tabs at all. A
small space with twelve pages pays for chrome it will never use, and the tab
model is presented as something every editor must reason about.

Tabs are a solution for large multi-module docs sites (ERPNext-scale). They
should be opt-in.

The toggle also strands the page actions. **View Page / Save / ⋮** live inside
the tab row today, teleported from `WikiDocumentPanel` into `#wiki-page-actions`
(`SpaceDetails.vue:85`). Turn the row off and the actions have no home.

## Goal

A per-space **Tabbed Navigation** switch in Space Settings, off by default. Off:
no tab row anywhere (editor, reader, mobile), the sidebar shows the whole tree,
and no tab-management actions are offered. On: today's behaviour.

Independently of the toggle, page actions move out of the tab row into a header
row of their own, so their position no longer depends on tab state.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where the flag lives | New `enable_tabs` (Check) on **Wiki Space**, in the Version 3 tab beside `home_tab_title` / `home_tab_icon`. |
| 2 | Default + migration | **Off for every space, no patch.** Spaces that already have `is_tab` groups lose their bar until an editor turns it on. Chosen deliberately over an auto-on patch: the feature is new enough that no production space depends on it, and a clean default keeps the flag's meaning unambiguous. |
| 3 | Page actions | **Own header row in the content column, always** — tabs on or off. The `Teleport` to `#wiki-page-actions` goes away, and with it the tab row's action slot. One layout, one code path. |
| 4 | Data when toggled off | `is_tab` / `tab_icon` on nodes are **left untouched.** The flag is presentational: turning it back on restores the same tabs. No validation throw on writing `is_tab` while tabs are off — git-sync's carry-forward and CR merges must keep working regardless. |
| 5 | Enforcement surface | `get_space_tabs` returns `[]` for a tabs-off space. That single gate covers the entire reader (desktop bar, mobile header, chrome height, sidebar subtree gating) because every reader surface already handles the empty case. The editor gates on `space.doc.enable_tabs` directly, since its bar is derived from the draft tree, not from `get_space_tabs`. |
| 6 | Tab management actions | "New Tab", "Convert to tab" and inline icon/rename hide when tabs are off — `can_manage_tabs` in the frontend becomes `canManageTabs && tabsEnabled`. The server-side `can_manage_tabs` permission is unchanged (per decision #4 it stays a permission question, not a feature-flag question). |

## Current state (what the toggle has to switch off)

**Editor** — `SpaceDetails.vue:70-86` renders the row `v-if="tabs.length"`, which
is always true: `buildTabList` (`lib/spaceTabs.js:32`) unconditionally `unshift`s
the Home entry. `useSpaceTabs` also swaps the sidebar's root to the active tab's
subtree (`composables/useSpaceTabs.js:68-78`) — with tabs off that must fall back
to the full tree.

**Reader** — `get_space_tabs` (`wiki_document.py:934`) feeds `space_tabs` into
the render context (`:535`). Consumers: `layout.html:67` (`data-wiki-tabs` body
attribute → `--wiki-chrome-h` 97px vs 53px in `main.css:65-78`), `header.html:7`
(navbar keeps its bottom border when there are no tabs), `tabs.html:21`,
`mobile_header.html:194`, and `sidebar.html:30` (untabbed subtree is gated behind
Home's presence). **All five already branch on an empty `space_tabs`**, so the
reader needs no template change — only the gate inside `get_space_tabs`.

**Page actions** — `WikiDocumentPanel.vue:3-34` defines them via
`createReusableTemplate` and `Teleport defer`s them into the tab row. The
`defer` exists only because the target mounts asynchronously with the tabs.

## Tracer bullet plan

Branch: `feat/per-space-tab-toggle`. Spec committed first, then one commit per
phase.

### Phase 0 — Flag + reader gate (backend)

- `enable_tabs` (Check, default 0) on **Wiki Space**; `home_tab_title` /
  `home_tab_icon` become `depends_on: eval:doc.enable_tabs` so the desk form
  doesn't offer Home customisation for a space without tabs.
- `get_space_tabs` returns `[]` unless the space has `enable_tabs`. Read it in
  the existing `frappe.db.get_value` that already fetches `root_group` and the
  home meta — no extra query.

**Tracer:** flip the checkbox in desk on a tabbed space; the public reader loses
its tab row, the navbar regains its border, and the sidebar shows the previously
tab-gated content.

### Phase 1 — Settings toggle + editor gate (frontend)

- `GeneralPanel.vue`: a **Tabbed Navigation** `SettingsRow` + `Switch`, following
  the existing publish/feedback pattern (optimistic local ref, revert on error).
  Per CLAUDE.md "Frontend / Backend Sync", the field is enumerated explicitly.
- `useSpaceTabs` takes an `enabled` getter: when false, `tabs` is `[]` and
  `visibleTreeData` passes the tree through untouched.
- `SpaceDetails.vue`: the row renders `v-if="tabsEnabled && tabs.length"`, and
  `can-manage-tabs` passed to `SpaceTreePanel` is `canManageTabs && tabsEnabled`.

**Tracer:** toggle in Space Settings; the editor's bar appears/disappears without
a reload, and the sidebar shows every top-level node when off.

### Phase 2 — Page actions get their own row (frontend)

- Delete the `Teleport` + `#wiki-page-actions` target. `WikiDocumentPanel`
  renders the actions in a slim sticky header row at the top of the content
  column, right-aligned, above the scrolling editor.
- The existing loading skeleton already draws exactly this row
  (`WikiDocumentPanel.vue:93-100`), which is what the loaded state should have
  looked like all along.

**Tracer:** open a page in a tabs-off space and in a tabs-on space; the actions
sit in the same place in both, and ⌘S still saves.

### Phase 3 — Tests

- **Backend unit:** `get_space_tabs` returns `[]` for a tabs-off space that has
  tab groups, and the full list once enabled. Temp-revert the gate to confirm the
  test fails without it (per CLAUDE.md).
- **E2E:** extend `e2e/tests/tab-navigation.spec.ts` — the suite's fixture space
  must now enable tabs explicitly (every existing test depends on the bar), plus
  a new test asserting a tabs-off space shows no bar in the editor and no bar in
  the reader while its content stays reachable in the sidebar.

## Out of scope

- Migrating existing spaces (decision #2 — none, by choice).
- A global (Wiki Settings) default for the flag.
- Changing who may manage tabs (`can_manage_tabs` is unchanged).
- Reader-side chrome redesign; the 53/97px chrome variable already handles both
  states.

---

## Progress log

_(appended per phase)_
