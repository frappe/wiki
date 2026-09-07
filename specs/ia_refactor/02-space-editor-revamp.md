# Space Details / Editor Page Revamp

Date: 2026-09-01
Status: **In progress.** Phases 1–3 (header row, prose column + outline, page
settings panel) built; phases 4–5 pending.
Depends on spec 01 (sidebar drill-in).
Prototype: `wiki-proto` — `PageContent.vue`, `PageSettingsPanel.vue`,
`SpaceSettingsDialog.vue`, `Space.vue`.

## Problem

With the tree moved into the sidebar (spec 01), the content column is the whole
editing surface — but today's `WikiDocumentPanel` grew organically: page
actions are scattered (dialog-based page settings, banner-owned submit), the
prose column isn't stable, the outline is a bolt-on, and space settings is a
bespoke dialog that predates frappe-ui's Settings family.

## Goal

The prototype's editor shape: a 48px header row (breadcrumbs · view live ·
page settings toggle · Submit for review · more-menu), a toolbar row under it,
a centered `max-w-3xl` prose column with the title input inline, a floating
"On this page" outline in the right gutter, a 352px page-settings side panel,
and autosave reporting instead of a Save button. Space settings rebuilt on
frappe-ui `SettingsDialog`.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Header row | h-12, border-b. Left: `Breadcrumbs` from tree ancestors (last crumb tracks the unsaved title live). Right: View live (ghost eye), Page settings toggle (pressed = `subtle` variant while panel open), then per-mode: git-synced → "Edit on GitHub" + Read-only badge; else → solid "Submit for review" + more-menu (Rename, Change route, Unpublish, Delete). |
| 2 | Submit for review | Header primary action. Same backend flow the banner/strip uses; strip (spec 01) and header both submit the space's draft CR — one store action, two triggers. |
| 3 | Page settings | **Side panel, not dialog.** 352px, own h-12 header sharing the toolbar's row line. Fields: Title, Slug, Route (+ public URL description), Published switch, Meta title/description/image, plus read-only Details (words, reading time, last edited, edited by). Existing `PageSettings.vue` dialog content migrates; dialog retires. Panel and outline never show at once. |
| 4 | Outline | Floating `aside` over the right gutter (absolute, `lg:` only), no box, `SidebarItem` rows, h2/h3 with indent, scroll-to-heading. Replaces the current `EditorTableOfContents` placement; the composable `useDocumentOutline` is reused. |
| 5 | Prose column | `mx-auto max-w-3xl`, title as borderless input (text-3xl font-semibold) above the editor content, amber dirty dot on the title's trailing edge — same mark the tree uses. |
| 6 | Autosave | Already exists (draftWorkspace buffers). The header stops offering Save; save state surfaces via the dirty dot (+ existing Cmd/Ctrl+S kept as a manual flush). |
| 7 | Empty state | No page selected → prototype's "Pick a page to edit" + New page button (replaces `SpaceWelcome`; keep the git-sync-in-progress variant). |
| 8 | Space settings dialog | Rebuild on frappe-ui `SettingsDialog`/`SettingsPanel`/`SettingsRow`: tabs **General** (name, route prefix + Update-routes flow, logo → spec 3 avatar, published), **Navigation** (show in switcher, order — the tab toggles are gone with the tab feature, spec 01), **Access** (roles table — role + Read/Write select + remove, "no roles = public" copy, accept contributions, collect feedback), **Git sync** (repo/branch/subdir facts, last sync status + commit, Sync now, connect flow when not synced). Existing `SpaceSettings/*` panels migrate; Clone space stays in the General panel actions. |
| 9 | Frontend/backend sync | Every `Wiki Space` field surfaced in these panels is enumerated explicitly in the frontend (house convention); the rebuild must not drop fields the old panels carried. Inventory them before deleting. |
| 10 | Tabs bar | Gone before this spec starts — removed by spec 01 (program decision 2). The content column has no bar above it. |

## Current state

- `components/WikiDocumentPanel.vue` (587) — editor host; keeps data flow
  (draft buffers, publish state), sheds its ad-hoc header.
- `components/WikiEditor.vue`, `WikiToolbar.vue`, `WikiBubbleMenu.vue`,
  tiptap-extensions — untouched. This spec is chrome, not editor internals.
- `components/PageSettingsPanel.vue` — the panel (replaced the
  `PageSettings.vue` dialog).
- `components/EditorTableOfContents.vue` + `composables/useDocumentOutline.js`
  — reuse logic, new placement.
- `components/SpaceSettings/{SpaceSettings,GeneralPanel,GitSyncPanel,PermissionsPanel}.vue`
  — content migrates into SettingsDialog panels.
- `components/WikiBreadcrumbs.vue` — check reusability for the header trail.
- `pages/ContributionReview.vue` / `DraftContributionPanel.vue` — CR review
  surfaces; out of scope beyond not breaking their routes.

## Phases

1. **Header row tracer.** New header on WikiDocumentPanel: breadcrumbs, view
   live, Submit for review wired to the existing CR submit, more-menu with the
   actions that already exist (rename, delete, publish toggle). Old placements
   removed as each lands.
2. **Prose column + outline.** Centered column, inline title input + dirty
   dot, floating outline.
3. **Page settings panel.** Panel component, toggle in header, dialog retired.
4. **Space SettingsDialog.** Panel-by-panel migration (General → Navigation →
   Access → Git sync), then delete `SpaceSettings/*`.
5. **Empty states** and read-only (git) chrome-drop pass.

Commit per phase; reconcile spec after each.

## Regression tests

- e2e: header submit-for-review round trip; page settings panel edits route +
  meta and they persist; outline scroll-to-heading.
- e2e: git-synced space shows read-only chrome (no toolbar, no submit).
- Unit: breadcrumb trail from ancestors incl. unsaved-title last crumb.
- Space settings: e2e smoke per tab (open, edit one field, save, reload).

## Landmines

- Roles/access edits flow through `Wiki Space` server-side validation — the
  Access panel must keep sending the same child-table shape
  (`Wiki Space Role`).
- `PageSettings` meta-image upload reuses the existing attachment flow; the
  panel must not regress the generated-meta-images feature
  (`specs/generated_meta_images.md`).
- Editor is keyed by page; panel state (open/closed) must survive page
  switches (module-scoped ui state, prototype's `state.ts` pattern).
- Print/reader CSS lives elsewhere; column width changes here are app-only.

## Open questions

- Does "Change route" stay in the more-menu when the settings panel already
  edits Route? (Prototype has both; probably menu item just opens the panel.)
- Word count/reading time: computed client-side from the draft (prototype) or
  server-side? Client-side is enough.

## Progress log

- 2026-09-01 — Spec written from `wiki-proto`.
- 2026-09-01 — Decisions locked: tabs removed, /spaces retired, duckdb+pandas approved, avatar auto-roll on create.
- 2026-09-07 — Phase 1 built: the editor header row.
- 2026-09-07 — Phase 2 built: centred prose column, floating outline, dirty dot,
  Save retired.
- 2026-09-07 — Phase 3 built: the page settings panel.

### Phase 1 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 6 — the header stops offering Save | Save is still in the header, demoted to `subtle` | The dirty dot that replaces it lands with the prose column (phase 2). Removing Save now would leave autosave with no visible signal in the content column, and would break ~20 e2e specs a phase earlier than the dot that lets them be rewritten. |
| 2 | Decision 2 — "one store action, two triggers" | One *component*: `SubmitForReviewButton.vue`, rendered by both the strip and the header | The confirm dialog is part of the action. Sharing only the store call would have duplicated the dialog; sharing open-state between two components would have made the header depend on the strip being mounted. |
| 3 | Decision 1 — more-menu carries Rename, Change route, Unpublish, Delete | Also Page settings and (for managers) View in Desk | Both already lived in this menu. Page settings leaves the menu in phase 3, when it becomes a header toggle for the side panel. |
| 4 | Rename | Its own dialog, not focus-into-the-title-input | Reusing the inline title input was tried first: the dropdown restores focus to its trigger as it closes, and it wins against a `requestAnimationFrame` chain. A dialog matches the tree's rename and needs no focus race. |
| 5 | Decision 1 — git-synced shows "Edit on GitHub" + Read-only badge | Shipped; the GitHub entry left the more-menu | Two triggers for one action a few inches apart. `githubEditUrl` is non-null only for synced spaces, which are exactly the read-only ones. |
| 6 | — | Delete redirects to the space route | The deleted page is the open one, so the editor would be pointing at nothing. `SpaceDetails` auto-opens the next page it can find. |

Verified in the browser at 1440×900: the header renders breadcrumbs · View live
· Save · Submit for Review · ⋯; Submit appears in both the header and the strip
once the space has a pending change; rename through the menu updates the title
input, the breadcrumb and the tree; delete writes a delete draft and hands the
route back to the space, which opens the next page. Unit suite 74 pass; lint and
build pass on the touched files.

Two gaps this phase leaves:

- **`DraftContributionPanel` still has the old header.** A page created in the
  draft workspace opens on the draft route, whose panel is a different
  component with its own Save-only header. The two now disagree. Folding it in
  belongs with phase 2, which touches the same prose column.
- **No e2e yet.** The header's shape still changes twice (Save leaves in phase
  2, the page-settings toggle arrives in phase 3), so the specs the "Regression
  tests" section asks for are written once it settles.

### Phase 2 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 4 — floating outline in the right gutter, `lg:` only | Shipped as an absolute `aside` over the gutter, but the rail's threshold moved from 900px to ~1140px of editor width | It used to take a column of its own, so 900px was enough. Floating needs a gutter to float in: the 768px column plus a rail's width on each side. Between the two numbers the collapsible strip takes over — a 1280px window with the sidebar open now gets the strip where it used to get the rail. |
| 2 | Decision 4 — `SidebarItem` rows | Rows styled as sidebar items (rounded, hover fill, active fill), not the component | `SidebarItem` carries icon/label/active props built for navigation; the outline needs a heading level indent and a scroll handler. The look is the point, not the component. |
| 3 | Decision 6 — the header stops offering Save | Shipped, and submitting now **flushes** an unsaved buffer instead of being blocked by it | The old gate told the user to "Save your changes before submitting" — advice with no button behind it once Save is gone. The property the gate protected (never submit a CR that lacks what is on screen) is kept by flushing first, since the editor pushes every keystroke into the buffer. |
| 4 | Decision 2 — strip and header both submit | Header only; the strip keeps Merge, Reload latest and the ⋯ menu | Two identical primary buttons on one screen, and every e2e locator for Submit became ambiguous. The header sits next to the page the submit is about. |
| 5 | — | The header ⋯ is named **Page actions** | It collided with the strip's "More actions" (a strict-mode ambiguity that predates this spec), and it matches the sidebar's existing "Space actions". |
| 6 | — | Submit stays visible while the buffer is dirty even with zero change rows | Autosave takes ten seconds to turn typing into a change row. With no Save button, the window would otherwise show no action at all. |
| 7 | Phase 1 gap — `DraftContributionPanel` still had the old header | Folded in here: submit, Page actions menu (Change route, Delete Draft), dirty dot, no Save | It hosts the same prose column this phase reshapes. |
| 8 | — | `lucide-github` renders blank | `lucide-static` dropped brand icons (already noted in `SpaceSettings`). "Edit on GitHub" uses `lucide-pencil`; the two dead glyphs in `NewSpaceDialog` became `lucide-git-branch`. |

Verified in the browser at 1600×950 and 1280×900: the outline floats over the
right gutter with the prose column centred and unmoved, the strip variant takes
over at the narrower width, the dot appears on the title as soon as the buffer
diverges and clears on ⌘S, and Submit with an unsaved buffer lands the typed
text in the change request (checked in the review diff).

E2E: 13 header-Save clicks became `saveEditor()` (the ⌘S/Ctrl+S flush); three
assertions that encoded "Submit is disabled while unsaved" now assert the
workspace reports unsaved content; `page-settings-meta` opens "Page actions";
`git-sync-edit-on-github` clicks the header button rather than a menu item.
Locally `local-first-store.spec.ts` is 8/13 with these changes and 9/13 without
them, failing a different subset each run — all with the same "draft route never
resolves" timeout, which is the known local job-queue saturation rather than a
regression. Every test that failed with the changes passes in isolation except
`Reload latest after a failed save`, which fails on the unchanged build too.
Unit suite 74 pass; lint and build pass.

### Phase 3 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 3 — the `PageSettings` dialog's content migrates into the panel | It migrated, and the panel also took Title, Slug, Route and Published, which the dialog never carried | One Save, two write paths: the identifying fields go through the change request (`draftStore.updateNode`), the meta fields straight to the document (`setValue`). Meta is not in the CR's field list (`_CR_ITEM_SCALAR_UPDATE_FIELDS`) and carries nothing a reader sees, so routing it through a review would be ceremony for its own sake. |
| 2 | Decision 3 — panel and outline never show at once | A `showOutline` prop on `WikiEditor` gates **both** outline variants, not just the rail | The panel narrows the editor past the rail's threshold, so gating the rail alone would have swapped one list of the page for another. |
| 3 | Open question — does "Change route" stay in the more-menu? | No. The menu item and the route dialog are both gone; the route line under the title opens the panel | Three doors onto one field. The panel owns Route now, and the line under the title is the shortest way to it. |
| 4 | — | Slug is editable from the app for the first time | It is already in the CR's scalar update list and has simply never had a frontend. The backend keeps route and slug independent — a renamed slug does not recompute the route — so the panel shows both rather than implying one derives from the other. |
| 5 | Landmine — panel state must survive page switches | `composables/usePageSettingsPanel.js`, module-scoped | The editor component is torn down whenever the route leaves the page (a draft, another space); whether the panel is open is a fact about the workspace, not about the page. |
| 6 | — | The form adopts an outside change only for a field the user has not touched | The title is edited in three places at once (the prose input, the tree's rename, this panel). Resetting on every change would eat what is being typed; never resetting would save a stale title over someone else's rename. |
| 7 | Open question — word count client- or server-side? | Client-side, `lib/readingStats.js` | The count has to track the buffer between saves, and the buffer only exists in the browser. |
| 8 | — | The header toggle is hidden on read-only (git-synced) pages | Nothing in the panel is editable there. The rest of the read-only chrome drop is phase 5. |

Verified in the browser at 1600×950: the toggle reads pressed while the panel
is open, the panel's own h-12 header lines up with the toolbar row and the
toolbar stops at its border, meta fields save and the generated social card
re-renders, a title typed into the panel reaches the prose input and the tree
(as a change row), and the outline rail disappears while the panel is open and
comes back when it closes.

E2E: `page-settings-meta` now opens the header toggle instead of a menu item
and reads the panel by test id — 2/2 pass locally. `editor-toc` is 5/5 on a
retry; its "clicking an entry scrolls that heading into view" case fails and
passes on the same build, and this phase does not touch the highlight logic it
asserts. Unit suite 81 pass (74 + 7 new for `readingStats`); lint and build
pass on the touched files.

One gap this phase leaves: `DraftContributionPanel` has no settings toggle. A
page that exists only in the draft workspace has no `Wiki Document` behind it,
so there are no meta fields to edit and no `Details` to report; its route and
title stay in its own Page actions menu.
