# Space Details / Editor Page Revamp

Date: 2026-09-01
Status: **In progress.** Phases 1–5 built (header row, prose column +
outline, page settings panel, space settings tabs, empty states); phase 6 — the
alignment pass against the prototype — pending.
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
- `components/SpaceSettings/{SpaceSettings,GeneralPanel,NavigationPanel,AccessPanel,GitSyncPanel}.vue`
  — one panel per tab, hosted by the `SettingsDialog`.
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
6. **Alignment pass.** Read the built editor back against `PageContent.vue`
   and fix what drifted: the outline rail's threshold, the title row's extra
   chrome, the submit button's label. Plus the Overview's unreadable pagination.

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
- 2026-09-07 — Phase 4 built: the space settings tabs.
- 2026-09-07 — Phase 5 built: the empty space's way out; read-only pass verified.
- 2026-09-07 — Phase 6 built: the alignment pass against the prototype.

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

### Phase 4 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Decision 8 — "rebuild on frappe-ui `SettingsDialog`/`SettingsPanel`/`SettingsRow`" | The dialog was already built on them; this phase reorganised the tabs and filled in the missing fields | The bespoke dialog decision 8 describes had already been replaced. What was actually wrong was the tab set — General / Permissions / GitHub Sync — and the fields it left out. |
| 2 | Decision 8 — tabs General, Navigation, Access, Git sync | Shipped. `PermissionsPanel` became `AccessPanel`, `NavigationPanel` is new | Nothing under "Permissions" was about permissions in the Frappe sense; the tab decides who may read and what they may do, which is access. |
| 3 | Decision 8 — General carries name, route prefix, logo, published | Shipped, plus Clone space. Space name saves on blur; the route prefix row is the existing bulk-update-routes flow, retitled | Renaming a space is safe, so it saves where it is typed. Changing the prefix rewrites every published URL under it, so it keeps its confirm dialog and its own button. |
| 4 | Decision 8 — logo → spec 3 avatar | The existing logo upload stays as it is | The avatar is spec 03's whole subject; swapping it in here would build it twice. |
| 5 | Decision 8 — Access carries "collect feedback" | Moved here from General | It is a setting about what a reader may do on the page, which is what the rest of this tab decides. |
| 6 | Decision 8 — Git sync shows a "connect flow when not synced" | An empty state that says a space is connected at creation — no connect button | A repository is picked in `NewSpaceDialog` and there is no backend for binding one to an existing space. A button that cannot work is worse than a sentence that explains. |
| 7 | Decision 8 — Git sync facts include the subdir and the last commit | Added: Docs Folder, and the last synced commit as a link to it on GitHub | Both were already on the doc (`docs_subdir`, `last_synced_commit_sha`) and only the sync history showed a commit. |
| 8 | — | The Git Sync tab is always in the list, synced or not | It used to appear only for synced spaces. A tab set that changes shape per space teaches people that settings move around. |
| 9 | Decision 9 — no field the old panels carried may be dropped | Inventory kept whole: `is_published`, `app_switcher_logo`, `enable_feedback_collection`, `roles`, `allow_contributions`, the read-only git facts, plus the update-routes and clone flows. New: `space_name`, `show_in_switcher`, `switcher_order`, `docs_subdir`, `last_synced_commit_sha` | — |
| 10 | — | Every row still saves on its own, as the panels already did; no per-panel Save button (the roles table keeps its own, because a table is one edit) | The prototype's per-panel Save was drawn against prototype state. Switching the shipped panels to a buffered form would have been a second, larger change riding along with the tab move. |

Verified in the browser at 1440×900: all four tabs render, renaming the space
from General reaches the dialog's own sidebar and the app sidebar, the switcher
order round-trips to the document (checked through `frappe.client.get_value`),
Collect Feedback writes `enable_feedback_collection`, and an unsynced space's
Git Sync tab shows the not-connected state.

E2E: `space-permissions-role-search` is now `space-access-role-search` and
clicks the Access tab — 2/2 pass. It was already failing before this phase on
`getByTitle('Settings')`, which spec 01 replaced with the sidebar's "Space
actions" menu; fixed while renaming it. `spa-editor.mobile` asserts the Access
tab is visible, 4/4 pass — its own drawer still has a gear titled "Settings",
which is a mobile surface spec 01 did not touch. Unit suite 81 pass; lint and
build pass.

### Phase 5 reconciliation

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Phase 5 — "read-only (git) chrome-drop pass" | Nothing left to drop. The sweep found the gates already in place: toolbar, bubble menu and table menu (`WikiEditor` 6/21/24), `editable` and the `is-editable` class, the save and Cmd+S guards, Submit, the page-settings toggle, the route line's edit affordance, the panel itself, and the tree's create/reorder/row actions | Phases 1–3 gated each surface as they built it rather than leaving a pass to the end. The pass ran as a verification, and `git-sync-readonly` / `git-sync-edit-on-github` still pass unchanged |
| 2 | Decision 7 — "No page selected → 'Pick a page to edit'" | That wording only survives for a tree that has pages. An empty space gets "Create your first page" | `SpaceDetails` auto-opens the first page, so "no page selected" is not actually reachable on a populated space — the state the user lands in is *the space has none*. Telling them to pick from an empty tree is advice with nothing behind it |
| 3 | Decision 7 — the empty state replaces `SpaceWelcome` | `SpaceWelcome` was rewritten, not replaced | It is a sibling route of the editor (`router.js:44`), not a branch inside it as in the prototype. Moving it into `WikiDocumentPanel` would have meant hoisting the header row out for a state whose header has nothing actionable on it |
| 4 | — | The empty state carries no header row, unlike the prototype | Every control in that row is about a page. On an empty space the whole row would be disabled or hidden, which is a worse thing to draw than nothing |
| 5 | — | The sidebar keeps "No pages yet"; the content column says "Create your first page" | Both columns showed the same sentence side by side. The tree states the fact where the pages would be, the content column carries the action — one message across two columns instead of one message twice |
| 6 | Decision 7 — "+ New page button" | `composables/useNewPageRequest.js`, module-scoped, consumed by `WikiDocumentList` | The create dialog lives in the tree with the route-computation it needs, and the tree is a sibling column, not an ancestor. Same shape as `usePageSettingsPanel` |
| 7 | — | A consumable pending flag, not an event | The mobile tree lives in a drawer that unmounts while closed, so at the moment the button is pressed there is nobody to hear an event. The flag survives until the tree mounts; `SpaceDetails` opens the drawer to make that happen |
| 8 | — | The content column renders nothing until the tree has loaded | An unloaded tree and an empty one look identical. Without the gate a populated space flashes "create your first page" on entry — the trap `space.js` already documents for the sidebar |
| 9 | — | Fixed: creating a page could land on "Draft not found" | Out of scope on paper, but it is the empty state's only action. Navigation to `/draft/tmp_*` races the create; when the create wins, `promoteKey` has already moved the buffer to the real key. The panel's route-swap watcher was lazy, so it never fired for a key resolved before it mounted, and no reload could settle it — the temp key was gone for good. The watcher is now `immediate`, and `loadCrPage` follows a promotion instead of reporting the page missing |

Verified at 1440×900: an empty space shows the tree's "No pages yet" beside the
content column's "Create your first page" + New page; the button opens the
tree's create dialog and lands in the editor on the page it made. The
`editor-toc` "clicking an entry scrolls that heading into view" failure was
checked against a clean `HEAD` and fails identically there — pre-existing, not
from this phase. New e2e `space-empty-new-page`; `space-default-page` retargeted
to the new copy. Both git-sync specs, unit suite (81), lint and build pass.

### Phase 6 reconciliation

The build was read back against `PageContent.vue` at 1440×900 and 1280×800.
Four things had drifted; all four are reversals of calls made in earlier
phases, so each row names the row it overturns.

| # | Spec said | What shipped | Why |
|---|-----------|--------------|-----|
| 1 | Phase 2 row 1 — the rail's threshold is ~1140px of editor width, and the prose column stays "centred and unmoved" | Both reversed. The rail's gutter is **reserved** (`pr-60` on the content row while the rail is up), the way the prototype reserves it, and the threshold drops to 1008 — the 768px column plus that reserve | A rail that needs a gutter on *both* sides needs 768 + 2×186 of width, which is a ~1400px window. Reserving one gutter needs 1008, which a 1280px laptop has (1019px of editor). The column now shifts left when the rail appears; that is the price the prototype already pays, and it buys the outline back on the most common screen |
| 2 | Decision 4 — the rail is a prototype `w-52` | Rail widened 180 → 208px | 180px truncated most real headings ("Overriding classes an…"), which is a table of contents that cannot be read. 208 + `pr-4` still fits inside the 240px reserve |
| 3 | Phase 3 row 3 — the route line under the title is the door to the Route field | The line is gone; the header's panel toggle is the only door | Decision 5 draws the title row as the title and the dirty dot. The publish badges (`Published` / `Not Published` / `Has Draft Changes`) went with it — the panel's `Published` switch says the same thing where the field is, and the header's View-live eye already reports it |
| 4 | — | `DraftContributionPanel` loses its route line too; its ⋯ menu already carries "Change route" | The two editors share one prose column. Leaving the line on one of them is the disagreement phase 1 opened and phase 2 closed |
| 5 | — | The draft panel **keeps** its blue `Draft` badge | It names the surface, not a publish state. The prototype has no draft route to draw it against, so decision 5 does not reach it |
| 6 | Decision 1 — solid "Submit for review" | Button is now `solid` + `theme="gray"` and reads "Submit for review" | It had drifted to the default theme and title case. The visibility rule (phase 2 row 6 — visible while the buffer is dirty even with no change rows) is untouched |
| 7 | — | Overview's "Load more" restyled from `ghost` full-width to a centred `subtle` button | Out of this spec on paper, found in the same pass. With 80 spaces the button renders under 50 rows as transparent text 24px off the bottom edge, and reads as absent |
