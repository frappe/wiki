# Mobile-Friendly Wiki (App-Wide)

Date: 2026-06-26
Status: **Planned.** Audit complete; design below reflects decisions made during planning (see [Decisions](#decisions)). Not yet implemented. (Originally scoped to the editor only; broadened to the whole SPA per follow-up, and grounded in the patterns Frappe CRM already ships — see [Reference: how Frappe CRM does it](#reference-how-frappe-crm-does-it).)

## Goal

Make the **entire Wiki SPA** (`frontend/src/`) usable on a phone — not just the editor. Today the app is built as a fixed desktop layout that never adapts: sidebars consume the screen, the editor collapses to a sliver, list-view tables and page headers overflow. The target:

- **Navigation:** global nav and the space document-tree are reachable on a phone without eating the content area.
- **List views:** Spaces and Change Requests are readable and tappable on a phone.
- **Editor — "core editing solid":** open a space → navigate to a page → type → apply common formatting (bold/italic, headings, lists, links) → insert an image → save. Advanced affordances (tables, drag-reorder) degrade gracefully.

Out of scope: the **public reader** (`wiki/templates/wiki/`, server-rendered Jinja/Alpine) — a separate surface.

## Decisions

Settled during planning (with the user):

- **Scope → whole SPA, mobile-friendly; editor target is "core editing solid."** Not full edit parity.
- **Mirror Frappe CRM's mobile architecture.** CRM (same stack: Vue 3 + frappe-ui + Tailwind) already solves this; we copy its proven patterns rather than invent. See the reference section below.
- **Breakpoint → `< 768px` is "mobile"** (Tailwind `md`; matches CRM's `isMobileView`). Use mobile-first Tailwind (`px-3 sm:px-5`) in templates and `@media (max-width: 767px)` in plain CSS.
- **Mobile detection → a reactive composable.** CRM uses a non-reactive `computed(() => window.innerWidth < 768)`; we improve on it with `@vueuse/core` (already a dependency) so it reacts to rotation/resize. Single source of truth.
- **Sidebars → off-canvas drawers on mobile** (CRM's `MobileSidebar` pattern), toggled by a hamburger, auto-closing on navigation. CRM builds its drawer on `@headlessui/vue`; **we use `reka-ui`'s `Dialog*` primitives instead** — `reka-ui@2.6.1` is already installed (a frappe-ui dependency) and is the library frappe-ui itself is migrating to, so we align with it rather than the legacy headlessui transitive dep. reka-ui has no literal `Sidebar`/`Drawer` component, so we compose the drawer from `DialogRoot`/`DialogPortal`/`DialogOverlay`/`DialogContent` (which give us focus-trap, scroll-lock, ESC, and ARIA) plus our own slide-in `translate-x` transition — the same way CRM uses headlessui's `Dialog`, and the same approach shadcn-vue's Sidebar block takes.
- **Editor toolbar on mobile → horizontal-scroll top toolbar** (keep `WikiToolbar.vue` docked at top, let it scroll). Not a keyboard-docked bottom bar.
- **List views on mobile → keep frappe-ui `ListView`, horizontal scroll + mobile-first margins** (exactly what CRM does — it does *not* convert tables to cards). A card layout is an optional later enhancement, not v1.
- **Touch targets → 44×44px minimum on mobile** for all interactive controls. Desktop sizes unchanged.

## Reference: how Frappe CRM does it

Studied from `apps/crm/frontend/src`. The patterns we mirror, with sources:

1. **One mobile flag.** `composables/settings.js` exports `isMobileView = computed(() => window.innerWidth < 768)` and `mobileSidebarOpened = ref(false)`, imported directly by ~20 components. (Caveat: not reactive to resize — we fix that with `useMediaQuery`/`useWindowSize`.)
2. **Layout chosen at the root.** `App.vue` swaps the whole shell: `Layout = computed(() => window.innerWidth < 640 ? MobileLayout : DesktopLayout)` via `defineAsyncComponent`. The two `Layouts/*.vue` are thin shells with a shared `<slot/>`, differing only in which sidebar/header they mount.
3. **Off-canvas sidebar drawer.** `components/Mobile/MobileSidebar.vue` — a 260px panel sliding from `-translate-x-full` over a dimmed overlay, driven by `mobileSidebarOpened`. **Auto-closes on navigation** inside `SidebarLink.vue`: `if (isMobileView.value) mobileSidebarOpened.value = false`.
4. **Header teleport.** `LayoutHeader.vue` `Teleport`s page headers into `#app-header`, a target div present in both `AppHeader` (desktop) and `MobileAppHeader` (mobile, which also holds the hamburger). One header component, two mount points.
5. **Toolbar actions collapse into a `more-horizontal` dropdown on mobile.** `CustomActions.vue`: standalone buttons render only `!isMobileView`; otherwise they fold into a single `Dropdown`. `ViewControls.vue`/`Filter.vue` have whole separate `v-if="isMobileView"` stacked branches with icon-only (`hideLabel`) buttons.
6. **List views stay tables + horizontal scroll.** `ListViews/*` render frappe-ui `<ListView>` unchanged; mobile only shrinks margins (`mx-3 sm:mx-5`). No card swap. Only complex **detail** pages get dedicated `pages/Mobile*.vue` (selected via a `handleMobileView()` helper in the router's dynamic `import()`).
7. **Dialogs stay frappe-ui `Dialog`** (not bottom sheets); mobile only tweaks padding (`px-4 sm:px-6`) and hides manager-only affordances.
8. **Viewport meta** includes `viewport-fit=cover` (notch-safe) and PWA hints.

## Root Cause (why the app is unusable on a phone today)

The layout is a fixed desktop row that never adapts. There is **effectively zero responsive code** in the frontend — a repo-wide scan finds Tailwind breakpoints in only `pages/ContributionReview.vue` (one `lg:grid-cols-2`) and one `@media` in `MermaidBlockView.vue`; there is **no `isMobile`/`useMediaQuery` anywhere**. The viewport meta tag *is* present, so this is layout, not zoom.

**Editor "can't edit" (primary symptom):** `pages/SpaceDetails.vue` lays out the tree `<aside>` and editor `<main>` side-by-side in `flex h-full`. The aside is pinned by an **inline pixel style** `:style="{ width: sidebarWidth + 'px' }"` from `useSidebarResize.js`, whose **minimum is 200px** (default 280) — it never collapses. To its left, `layouts/MainLayout.vue` always renders the global frappe-ui `<Sidebar>` in a `flex-row`. So 250–500px is gone before the editor gets anything; `<main>` has `min-w-0` and collapses to a sliver. Resize is **mouse-only** (`mousedown`/`mousemove`).

**Editor toolbar overflows.** `WikiToolbar.vue` is a single non-wrapping flex row of ~20 buttons with `overflow` unset — right-hand buttons (image/video/PDF/undo) are unreachable. Buttons are 32px; bubble-menu buttons 28px (both below 44px).

**List/nav surfaces:**
- `SpaceList.vue` — header is `flex items-center justify-between` with a search field **and** a "New Space" button side-by-side; cramped on a phone. The list is a frappe-ui `ListView` table (4 columns w/ widths) — needs horizontal scroll + margin shrink. The "Create Space" `Dialog` is long (GitHub repo/branch/folder pickers) — needs mobile padding review.
- `Contributions.vue` — `Tabs` + `ListView` with up to 5 columns (`reviewColumns`) — same table-overflow story.
- `ContributionReview.vue` — already has `grid grid-cols-1 lg:grid-cols-2` for the diff (good: stacks on mobile), but the rest of the review chrome is unaudited for touch.
- `MainLayout.vue` access-denied state is centered/fine.

**Slash menu vs. keyboard / bubble menu vs. native selection** — secondary editor issues (popups can hide behind the on-screen keyboard; bubble menu can fight the OS selection UI).

## Current State (what we build on)

- **Shell:** `App.vue` → `MainLayout.vue` (global frappe-ui `Sidebar` + `<slot>`) → `<router-view>`. No header-teleport abstraction yet; pages render their own headers inline.
- **Pages:** `Spaces.vue`→`SpaceList.vue`, `Contributions.vue`, `ContributionReview.vue`, `SpaceDetails.vue` (tree aside + `<main>` hosting `WikiDocumentPanel.vue` → `WikiEditor.vue`).
- **Editor:** TipTap v3. `WikiEditor.vue` builds it; `WikiToolbar.vue` (top toolbar), `WikiBubbleMenu.vue` (selection menu), `slash-commands.js` + `SlashCommandsList.vue` (`/` menu). Content CSS: `frontend/src/wiki-editor-content.css` (global via `main.js`); toolbar/bubble CSS is `scoped`.
- **Tree:** `SpaceDetails.vue` aside → `WikiDocumentList.vue` (uses `NestedDraggable.vue`).
- **Deps:** `@vueuse/core` present (use it for the media query). `reka-ui@2.6.1`, `radix-vue@1.7.4`, and `@headlessui/vue@1.7.14` are all available **transitively via frappe-ui** — we deliberately build the drawer on `reka-ui` (frappe-ui's forward direction), not on the legacy headlessui. frappe-ui itself provides `ListView`, `Dialog`, `Button`, `Dropdown`, `Sidebar`.
- **Viewport meta** present in `frontend/index.html` (lacks `viewport-fit=cover` that CRM adds).
- **Tests:** one `Desktop Chrome` Playwright project; no mobile viewport. Project memory (`project_e2e_local_job_meltdown`): git-sync e2e specs flood the local bench queue — keep new mobile specs lean.

## Approach — Tracer Bullets

Thin vertical slices, foundation first, each independently committable and verifiable at a 375px viewport.

### Phase 0 — Mobile foundation (no visible change) — ✅ Done (2026-06-26)
- ✅ Added `composables/useMobile.js` exporting a **reactive** `isMobile` (`useMediaQuery('(max-width: 767px)')` from `@vueuse/core`), a module-level singleton (one source of truth; CRM pattern #1, improved). Surfaced via a `useMobile()` accessor to match the repo's composable convention. (The planned `mobileNavOpen` ref was dropped in Phase 1 — global nav became a top bar, not a drawer, and the tree-drawer state lives locally in `SpaceDetails`.)
- ✅ Added `viewport-fit=cover` to the viewport meta in `frontend/index.html` (CRM pattern #8).
- Build verified green; no visible change, as intended.

### Phase 1 — Navigation drawers (unblocks everything) — ✅ Done (2026-06-26)
Resolved the Phase-1 open questions with the user: **global nav becomes a top app bar** (not a drawer) and we **adopt the `#app-header` teleport now**. Because the global nav is tiny (logo + 2 links + theme/logout), folding it into the top bar leaves a **single** drawer (the space tree) — which also dissolves the "two hamburgers" question.
- ✅ Built `components/MobileDrawer.vue` on `reka-ui`'s `DialogRoot`/`DialogPortal`/`DialogOverlay`/`DialogContent` with a `side` prop. Slide-in is done with **CSS keyframes keyed off reka's `data-state`** (not a plain transition, which wouldn't run on initial mount) — so no `tailwindcss-animate` dependency. Focus-trap/scroll-lock/ESC/ARIA come from the primitives.
- ✅ **Global nav → `components/MobileTopNav.vue`**: on mobile `MainLayout` renders it (top) instead of the frappe-ui `<Sidebar>` (left); content goes full-width. The logo opens a `Dropdown` (Spaces / Change Requests / Toggle Theme / Log out). It hosts the `#app-header` teleport target (CRM pattern #4).
- ✅ **Space tree** (`SpaceDetails.vue`): on mobile the inline px width + `col-resize` handle are dropped (`v-if="!isMobile"`); the tree renders inside `MobileDrawer`. Extracted `components/SpaceTreePanel.vue` so the **same** tree markup serves both the desktop aside and the mobile drawer (no duplication). The tree-toggle + space name teleport into `#app-header`. Auto-closes on page navigation (watch on route params) and on leaving the mobile breakpoint; backdrop/ESC close via the primitives.
- ✅ Extracted `composables/useTheme.js` so the top nav and the desktop `Sidebar` share one theme toggle.
- ✅ Build green. Mobile Playwright project (`Pixel 7`, chromium) + lean tracer spec added (see Testing). **Live e2e not yet run** — local bench was down at implementation time.
**Tracer result:** the content/editor area fills the screen on a phone; you can read pages and type.

### Phase 2 — List & nav surfaces — ✅ Done (2026-06-26)
- ✅ `SpaceList.vue`: mobile-first padding (`p-3 sm:p-4`); header stacks on mobile (`flex-col sm:flex-row`) so search goes full-width and **"New Space" collapses to an icon button** (label `hidden sm:inline`, `:title` kept for a11y). `ListView` wrapped in `min-w-[600px] sm:min-w-0` inside the existing `overflow-auto` so the table scrolls horizontally and stays readable instead of compressing (CRM pattern #6).
- ✅ `Contributions.vue`: mobile-first margins (`px-3 sm:px-5`); review tables wrapped in `min-w-[720px] sm:min-w-0` for the same horizontal-scroll behavior.
- ✅ `ContributionReview.vue`: confirmed the diff is `lg:grid-cols-2` (stacks below `lg`, good). Made the **header stack on mobile** (`flex-col sm:flex-row`) so a long CR title can't push the Approve/Merge actions off-screen. (The inline `grid-cols-2` at the conflict checkboxes is just two short checkboxes — fine at 375px, left as-is.)
- ✅ **Create Space dialog audited at 375px** (agent-browser): frappe-ui's `Dialog` already centers, fits the viewport with margins, stacks fields, and uses a full-width action — no padding/full-height override needed (CRM pattern #7). Row actions ("View"/"Assign") left inline; they fit within the horizontal-scroll table, so the optional "collapse under row" wasn't necessary for v1.
- ✅ Extended the mobile e2e with a **list-view smoke**: Spaces + Change Requests render with no page-level horizontal overflow (tables scroll inside their own box) and rows navigate. All 3 mobile specs green.

### Phase 3 — Editor toolbar that doesn't overflow
- `WikiToolbar.vue`: on mobile make the row `overflow-x: auto` (`-webkit-overflow-scrolling: touch`, `flex-wrap: nowrap`, hidden scrollbar); keep sticky-top. Bump `.toolbar-btn` to 44×44px under the mobile media query. Verify the headings dropdown (`position: absolute`) doesn't clip inside the scroll container — switch to a floating-ui/tippy popover on mobile if it does.
- Optionally adopt CRM's **collapse-into-dropdown** pattern (#5) for the least-used buttons if horizontal scroll feels cramped.
**Tracer result:** every formatting action is reachable and tappable on a phone.

### Phase 4 — Editor touch polish
- Bubble menu (`WikiBubbleMenu.vue`): 44px targets on mobile; verify it shows on touch selection and bias placement away from the OS selection UI. If unreliable on mobile, accept toolbar + slash as primary paths.
- Slash menu: ensure the tippy popup flips above the caret when the keyboard covers the bottom (add viewport boundary + `flip`, mirroring the bubble menu's modifiers); 44px row height in `SlashCommandsList.vue`.

### Phase 5 — Graceful degradation (the non-goals)
- **Tables:** wrap rendered tables in `overflow-x: auto` on mobile so wide tables scroll instead of breaking layout. No mobile table-editing UX.
- **Tree drag-reorder** (`NestedDraggable.vue`): desktop affordance; acceptable if awkward/disabled on mobile. Confirm tapping a row still navigates. No touch DnD this pass.

## Non-Goals

- **Public reader** styling (`wiki/templates/wiki/`).
- **Full edit parity** on mobile (we do "core editing solid").
- **A keyboard-docked bottom toolbar** (chose horizontal-scroll top toolbar).
- **Card-layout list views** (match CRM: tables + horizontal scroll; cards are a possible later enhancement).
- **Full mobile table editing** and **touch drag-and-drop reorder**.
- **Dedicated `pages/Mobile*.vue` rewrites** (CRM pattern #6, optional) unless a surface proves it needs one — start with responsive single components.
- **PWA / offline** work beyond what the local-first store already provides.

## Testing

Per CLAUDE.md (regression tests + e2e for workflows):

- **Add a mobile Playwright project** to `playwright.config.ts` using `devices['Pixel 7']` (or `iPhone 13`), reusing the existing auth setup. Keep specs **lean** (project memory: local job-queue flooding).
- **Core editing e2e on the mobile project** — the tracer path: open a space → open tree drawer → pick a page → type → bold via toolbar → insert text via slash menu → save → reload → assert persisted. Regression guard for "can't edit on mobile."
- **Phase-1 assertion:** at 375px, the editor's contenteditable has a usable width (`> 300px`) and is focusable. Temp-revert the drawer change to confirm the test fails without the fix (CLAUDE.md regression discipline).
- **List-view smoke (mobile project):** Spaces and Change Requests render, rows are tappable, headers don't overflow.
- **Manual smoke** on a real phone viewport for touch-feel items (toolbar scroll, bubble menu, slash vs. keyboard) that are hard to assert deterministically.

## Open Questions

- ~~**Drawer entry points:** two drawers...~~ **Resolved (Phase 1):** global nav became a **top app bar** (logo → dropdown), so there is only **one** drawer (the space tree). No competing hamburgers.
- ~~**Adopt CRM's header-teleport (`#app-header`) abstraction now...**~~ **Resolved (Phase 1):** adopted now. `MobileTopNav` hosts `#app-header`; `SpaceDetails` teleports its contextual header (tree toggle + space name) into it.
- **Headings dropdown** inside a horizontally-scrolling toolbar — keep CSS-absolute or switch to a floating-ui popover? Decide at Phase 3.
- **Bubble menu reliability** on mobile browsers — confirm at Phase 4; fall back to toolbar + slash if the native selection UI makes it unusable.
