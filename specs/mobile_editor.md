# Mobile-Friendly Wiki Editor

Date: 2026-06-26
Status: **Planned.** Audit complete; design below reflects decisions made during planning (see [Decisions](#decisions)). Not yet implemented.

## Goal

Make the **editor side** of Frappe Wiki usable on a phone. Today you cannot do basic edits on a mobile viewport — the editing pane is squeezed to a sliver and the toolbar overflows off-screen. The target is **core editing solid**: on a phone you can open a space, navigate to a page, type, apply the common formatting (bold/italic, headings, lists, links), insert an image, and save. Advanced affordances (tables, drag-reorder of the tree) may degrade gracefully but are not the focus of this work.

This is **not** about the public reader (`wiki/templates/wiki/`, server-rendered) — that is a separate surface. Scope here is the Vue SPA under `frontend/src/`.

## Decisions

Settled during planning (with the user):

- **Scope → "core editing solid".** Optimize the common path (open → type → format → image → save). Tables and tree drag-reorder degrade gracefully on mobile; they are explicitly *not* a goal (see [Non-Goals](#non-goals)).
- **Toolbar on mobile → horizontal-scroll top toolbar.** Keep `WikiToolbar.vue` docked at the top (where it is now) but let it scroll horizontally so the ~20 buttons stop overflowing/clipping. This is the lowest-risk change and reuses the existing component as-is. We are **not** building a separate keyboard-docked bottom bar in this pass. The selection **bubble menu** and the **slash (`/`) menu** remain available as the secondary input paths.
- **Breakpoint → `< 768px` is "mobile".** Matches Tailwind's `md` and the one existing `@media (max-width: 768px)` rule already in `MermaidBlockView.vue`, so the codebase stays consistent. Use Tailwind responsive prefixes (`md:`) in templates and `@media (max-width: 767px)` in the plain CSS files.
- **Sidebars → off-canvas drawers on mobile.** Both the global nav sidebar and the space document-tree become slide-in overlay drawers behind a hamburger/menu toggle, instead of consuming horizontal space. This is the single highest-impact fix (see Root Cause).
- **Touch targets → 44×44px minimum on mobile** for all editor controls (toolbar buttons, bubble-menu buttons, slash-menu rows), per the standard touch-target guideline. Desktop sizes (28–32px) are unchanged.

## Root Cause (why you can't edit today)

The layout is built as a desktop three-column row and never adapts. On a 375px phone screen, three things stack against the editor:

1. **Two always-on side-by-side sidebars eat the width.** `frontend/src/pages/SpaceDetails.vue` renders `<aside>` (the document tree) and `<main>` (the editor) in a horizontal `flex h-full`. The aside width is an **inline pixel style** `:style="{ width: sidebarWidth + 'px' }"` driven by `useSidebarResize.js`, whose **minimum is 200px** (`MIN_SIDEBAR_WIDTH = 200`, default `280`) — it never collapses. To its left, `frontend/src/layouts/MainLayout.vue` always renders the global frappe-ui `<Sidebar>` in a `flex-row`. So before the editor gets any space, ~250–500px is already gone. `<main>` has `min-w-0`, so on a phone it collapses to a near-zero-width sliver — **this is the "can't even do basic edits" symptom.**
2. **The toolbar overflows.** `WikiToolbar.vue` is a single `display: flex` row of ~20 buttons (`.toolbar-group`) with **no wrap and no scroll** and `overflow` unset. On a narrow pane the right-hand buttons (image, video, PDF, undo/redo) are simply unreachable.
3. **Touch targets are too small.** Toolbar buttons are `2rem` (32px); bubble-menu buttons are `28px`. Both are below the 44px minimum, so even when reachable they are hard to tap accurately.

Secondary issues found in the audit:

- **Sidebar resize is mouse-only.** `useSidebarResize.js` binds `mousedown`/`mousemove`/`mouseup` and the handle is `cursor-col-resize` — no touch equivalent, and the handle is meaningless on mobile (the sidebar should be a drawer instead).
- **Bubble menu vs. native selection.** `WikiBubbleMenu.vue` shows on text selection. On mobile, selecting text also raises the OS selection toolbar and selection handles; the two can collide/obscure each other. Worth verifying and, if needed, biasing placement.
- **Slash-command popup vs. virtual keyboard.** The `/` menu is a tippy popup positioned by `getReferenceClientRect` at the caret (`createSlashCommandsSuggestion` in `WikiEditor.vue`). When the on-screen keyboard is up, a `bottom-start` popup can render behind the keyboard. Needs flip/viewport-boundary handling on mobile.
- **Editor content max-width.** `.wiki-tiptap-editor` is `max-width: 100ch` centered; fine, but confirm horizontal padding doesn't waste scarce width on small screens.
- **Confirmed NOT the cause:** the viewport meta tag *is* present (`<meta name="viewport" content="width=device-width, initial-scale=1.0">` in `frontend/index.html` and built `wiki/www/wiki.html`). So this is layout, not a zoom/scaling problem.

## Current State (what we build on)

- **Shell:** `App.vue` → `MainLayout.vue` (global frappe-ui `Sidebar` + `<slot>`) → router view. The space editor is `pages/SpaceDetails.vue` (tree aside + main), whose `<router-view>` hosts `WikiDocumentPanel.vue` → `WikiEditor.vue`.
- **Editor:** TipTap v3 (Vue 3). `WikiEditor.vue` builds the editor; `WikiToolbar.vue` is the top toolbar; `WikiBubbleMenu.vue` is the selection menu; `slash-commands.js` + `SlashCommandsList.vue` are the `/` menu. CSS for content lives in `frontend/src/wiki-editor-content.css` (imported globally in `main.js`); toolbar/bubble CSS is `scoped` inside their `.vue` files.
- **Tree sidebar:** `SpaceDetails.vue` aside → `WikiDocumentList.vue` (uses `NestedDraggable.vue` for drag-reorder).
- **Responsive baseline:** effectively none. A repo-wide scan finds Tailwind breakpoints in only `pages/ContributionReview.vue` and one `@media (max-width: 768px)` in `MermaidBlockView.vue`. There is **no** `isMobile`/`useMediaQuery` anywhere yet — we introduce the first one.
- **frappe-ui Sidebar** already supports a `collapsed` model (`is-sidebar-collapsed` in `localStorage`), but collapsed still occupies space — it is not an overlay.
- **Tests:** Playwright config has a single `Desktop Chrome` project. No mobile viewport project exists. Note (from project memory): git-sync e2e specs flood the local bench job queue — keep new mobile specs lean and avoid piling onto that.

## Approach — Tracer Bullets

Per house methodology, ship thin vertical slices that each make the phone measurably more usable, newest-value-first. Each phase is independently committable and verifiable on a real/emulated phone viewport.

### Phase 0 — Mobile detection primitive
Add a single `useIsMobile()` composable (wrapping `@vueuse/core`'s `useMediaQuery('(max-width: 767px)')`) under `frontend/src/composables/`. One source of truth for the breakpoint, consumed by all later phases. No visible change yet.

### Phase 1 — Give the editor the screen (highest impact)
Make the **space document-tree** an off-canvas drawer on mobile. In `SpaceDetails.vue`: when `isMobile`, drop the inline `width` px style and the `col-resize` handle; render the `<aside>` as a fixed-position slide-in overlay with a backdrop, toggled by a header button (hamburger). `<main>` becomes full-width. Close the drawer on navigation (selecting a page) and on backdrop tap.
**Tracer result:** the editor pane fills the screen and you can type into it. This alone resolves the primary "can't edit" symptom.

### Phase 2 — Global nav as a drawer
Apply the same treatment to `MainLayout.vue`'s global frappe-ui `Sidebar` so it doesn't sit to the left of the space drawer on mobile. Single top-level menu affordance. Verify the two drawers (global nav + space tree) don't both try to own the same gesture/space — decide one entry point (e.g., global nav toggle in the app header, tree toggle in the space header).

### Phase 3 — Toolbar that doesn't overflow
In `WikiToolbar.vue`: on mobile make `.toolbar-group` (or `.wiki-toolbar`) `overflow-x: auto` with momentum scroll (`-webkit-overflow-scrolling: touch`), `flex-wrap: nowrap`, and hide the scrollbar visually. Bump `.toolbar-btn` to 44×44px under the mobile media query. Keep the sticky-top behavior. Confirm the headings dropdown (`toolbar-dropdown-menu`, `position: absolute`) still positions correctly inside a scroll container — if it clips, switch it to a tippy/floating-ui popover on mobile.
**Tracer result:** every formatting action is reachable and tappable on a phone.

### Phase 4 — Touch polish for the secondary menus
- Bubble menu (`WikiBubbleMenu.vue`): 44px targets on mobile; verify it shows on touch selection and doesn't fight the OS selection UI (bias `placement` to `top`, already in fallbacks). If it's unreliable on mobile, accept slash-menu + toolbar as the primary paths and keep bubble best-effort.
- Slash menu: ensure the tippy popup flips above the caret when the keyboard covers the bottom (`flip` modifier with viewport boundary; it already passes `maxWidth:'none'` — add boundary/flip like the bubble menu has). 44px row height in `SlashCommandsList.vue`.

### Phase 5 — Graceful degradation for the non-goals
- **Tables:** wrap rendered tables in an `overflow-x: auto` container on mobile so wide tables scroll instead of breaking layout. Don't build a mobile table-editing UX.
- **Tree drag-reorder:** `NestedDraggable.vue` drag is a desktop affordance; on mobile it's acceptable if reordering is awkward/disabled. Don't invest in touch DnD this pass. Confirm tapping a row still navigates.

## Non-Goals

- **Public reader styling.** Server-rendered `wiki/templates/wiki/` is out of scope.
- **A separate keyboard-docked bottom toolbar.** Decided against in favor of the horizontal-scroll top toolbar.
- **Full mobile table editing** (add/remove rows/cols by touch). Tables scroll for reading; editing them is a desktop task.
- **Touch drag-and-drop reorder** of the document tree.
- **Native app / offline-specific work** beyond what the local-first store already provides.
- **Full edit parity.** We are doing "core editing solid," not every advanced action tuned for touch.

## Testing

Per CLAUDE.md (regression tests + e2e for workflows):

- **Add a mobile Playwright project** to `playwright.config.ts` using `devices['Pixel 7']` (or `iPhone 13`), reusing the existing auth setup. Keep the mobile spec **small** to avoid the known local job-queue flooding (project memory: `project_e2e_local_job_meltdown`).
- **One core e2e on the mobile project** covering the tracer path: open a space → open the tree drawer → pick a page → type text → apply bold via toolbar → insert text via slash menu → save → reload → assert persisted. This is the regression guard for "can't edit on mobile."
- **Phase-1 assertion specifically:** at 375px width, the editor's contenteditable region has a usable width (e.g. `> 300px`) and is focusable/typeable. Temp-revert the drawer change to confirm the test fails without the fix (per CLAUDE.md regression-test discipline).
- **Manual smoke** on a real phone viewport for the touch-feel items (bubble menu, slash popup vs. keyboard, toolbar scroll), which are hard to assert deterministically.

## Open Questions

- **Two drawers, one gesture:** exact UX for global-nav vs. space-tree toggles on a phone — two separate buttons, or fold global nav into the space tree drawer? Resolve at Phase 2.
- **Headings dropdown inside a horizontally-scrolling toolbar:** keep CSS-absolute or switch to a floating-ui popover on mobile? Decide during Phase 3 implementation based on whether it clips.
- **Bubble menu reliability on mobile browsers:** confirm during Phase 4; fall back to toolbar+slash if the native selection UI makes it unusable.
