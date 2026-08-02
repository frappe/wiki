# Frappe UI v1 Upgrade

Date: 2026-07-04
Status: **Planned — decisions settled with the user (2026-07-04), not started.** Research done against frappe-ui `main` @ `1.0.0-beta.20` (2026-07-03) and the wiki frontend as of `develop` (36c32f0).

## Goal

Upgrade the wiki frontend from `frappe-ui@0.1.235` to the v1 line, and in the process:

1. **Delete the tiptap v2/v3 shim layer** (`src/lib/tiptap-vue-3-shim.js`, `src/lib/tiptap-shims/*`, the `tiptapShimsPlugin` in `vite.config.js`, and the related `resolve.alias` / `optimizeDeps.exclude` / prosemirror `resolutions`) — it exists only because frappe-ui 0.1.x internally expects tiptap v2 while wiki is on tiptap v3. frappe-ui v1 is built on tiptap 3 (`^3.26.0`), so the whole hack becomes obsolete.
2. **Migrate to the v1 component APIs** (Dialog, Dropdown, Autocomplete→Combobox, icons, tokens) so we stop accruing deprecation debt.
3. **Evaluate and adopt the new v1 building blocks where they beat our custom code**: the composable editor atoms (`frappe-ui/editor`), the shell components (`DesktopShell`, `MobileShell`, `MobileNav`, `PageHeader`, rebuilt `Sidebar`), and the `SettingsDialog` family.

## Upstream state (research summary, 2026-07-04)

- npm `latest` is `0.1.278` (2026-04-25) — the 0.1.x line is **done**. Active development is `1.0.0-beta.*` on the repo's `main` branch: 21 betas between 2026-05-27 and 2026-07-03 (a release every 1–3 days — still churning).
- Migration guide: `docs/content/docs/migration.md` (ui.frappe.io/docs/migration). Changelog: `v1-release/changelog.md`.
- **Deprecation policy:** all deprecated 0.1.x APIs keep working through v1.x with one-time dev-mode warnings; removals come after v1. So the upgrade can land in phases — nothing has to be migrated "big bang."
- **Tailwind stays v3** (preset at `frappe-ui/tailwind`; no v4 migration upstream yet). Peer deps: `vue >=3.5`, `vue-router ^4.1.6`. We satisfy both already.
- 0.1.235 → 0.1.278 contains no notable breaking changes (RTL, tests, TextEditor media fixes, vite plugin additions), so a two-step upgrade buys nothing — go straight to the beta.

### Breaking / renamed APIs that touch us

| Change | Wiki impact |
|---|---|
| `Dialog`: `options` blob → flat props; `v-model` → `v-model:open`; `#body-content` → default slot; `#body-title` → `#title`; `disableOutsideClickToClose` → `:dismissible="false"`; action `onClick:(close)=>` → `({close})=>` | 11 files import `Dialog` |
| `Dropdown`: grouped shape `{group, items}` → `{group, options}` | 7 files |
| `Autocomplete` deprecated → `Combobox` (single) / `MultiSelect` (multi); model value becomes the plain value, not the option object | 1 file (`components/Autocomplete.vue` wraps it) |
| `Input` deprecated (long-standing) | 2 files + global registration in `main.js` |
| Icons: Feather → Lucide; `FeatherIcon` deprecated; icon-string props take `lucide-*` names rendered as CSS classes by a Tailwind plugin | 1 file uses `FeatherIcon`; `feather-icons` dep droppable; we already use `~icons/lucide/*` and `lucide-vue-next` elsewhere |
| Tokens v2: espresso renames (`bg-surface-white` → `bg-surface-base`) + merged typography utilities (`text-base font-medium` → `text-base-medium`, and a size shift `text-lg`→`text-md` etc.). Codemod: `npx --package frappe-ui@beta tokens-v2 --dry-run .` — **not idempotent, run once** | app-wide class sweep |
| Class-injection props (`popoverClass`, `bodyClasses`, …) → `data-slot`/`data-state` CSS hooks | audit needed |
| `Popover`, DatePicker family, `Tree`, `Rating`, `Slider` API changes | little/no direct usage — verify during phase 3 |
| `Sidebar` rebuilt as composable family (`Sidebar`, `SidebarItem`, `SidebarHeader`, …); old `sections` prop kept via a legacy adapter | `components/Sidebar.vue` uses `:sections` |
| Toast SFC deprecated → imperative `toast(...)` | already imperative everywhere ✓ |
| Imperative dialogs `dialog.confirm()/danger()/prompt()` require `<FrappeUIProvider>` | already wrapped in `App.vue` ✓ |

### New in v1 that's relevant to wiki

- **`frappe-ui/editor`** (see Editor section below) + `frappe-ui/editor-style.css`.
- **Shells:** `DesktopShell`, `MobileShell`, `MobileNav`/`MobileNavItem`, `Rail`/`RailItem`, `PageHeader` (+ mobile/back-button variants), `ScrollArea`.
- **`SettingsDialog` family** (`SettingsPanel`, `SettingsSidebar`, `SettingsNavGroup`, `SettingsRow`, …) — maps to our space/wiki settings dialogs.
- Misc: `Skeleton`, `Pill`, `Slider`, `HoverCard`, `ContextMenu`, `ThemeSwitcher`, `KeyboardShortcutsModal`, `frappe-ui/list` molecules, `useCall`/`useList`/`useDoc` composables (optional; `createResource` family unchanged).
- New headless base is `reka-ui` — which our mobile drawer already builds on, so we align.

## Current state (what we're upgrading)

- 44 files import from `frappe-ui` (top-level specifier only, no deep imports). Heaviest: `Button` (22), `toast` (16), `Badge` (14), `FormControl` (12), `createResource` (12), `Dialog` (11), `Dropdown` (7).
- Data layer is fully on `createResource`/`createListResource`/`createDocumentResource` — **unchanged in v1**, no work.
- **Editor is fully custom tiptap v3** (`WikiEditor.vue` + `components/tiptap-extensions/*`). frappe-ui's `TextEditor` is not used at all. The shim layer exists purely so frappe-ui 0.1.x internals (which import tiptap v2 APIs) resolve against our tiptap 3 install:
  - `src/lib/tiptap-vue-3-shim.js` (re-adds `BubbleMenu`/`FloatingMenu` to `@tiptap/vue-3` root, `?original` bypass)
  - `src/lib/tiptap-shims/extension-table*.js` (re-add default exports)
  - `vite.config.js`: `tiptapShimsPlugin()` pre-resolver, `resolve.alias` for table cell/header/row, `optimizeDeps.exclude: ['@tiptap/vue-3']`
  - `package.json` `resolutions` pinning 4 prosemirror packages + shiki
- Shell is custom: `MainLayout.vue` flex shell branching on `useMobile()` (`max-width: 767px`); desktop uses frappe-ui `Sidebar` with the (now-legacy) `sections` prop; mobile is custom `MobileTopNav.vue` + `MobileDrawer.vue` (built on reka-ui Dialog primitives, per `specs/mobile_friendly_app.md`, shipped 2026-06-26).
- Theming: custom `useTheme.js` toggling `data-theme="dark"` on `<html>` — exactly the hook frappe-ui's tokens respond to. v1 adds a `ThemeSwitcher` component we can optionally adopt.
- Tailwind 3.4 + `frappe-ui/tailwind` preset; content globs include `node_modules/frappe-ui/src/components/**` — **must add `src/molecules/**`** (and keep globs in sync with v1's layout) or lucide icon classes used by frappe-ui molecules silently won't generate.
- `vite.config.js` uses `frappeui()` plugin with `frappeProxy`, `jinjaBootData`, `lucideIcons`, `buildConfig`; dev-mode alias to a local `../frappe-ui` checkout if present (useful for testing against the beta from source).

## Decisions (settled with the user, 2026-07-04)

1. **Build on `1.0.0-beta.x` now, pinned exact** (no `^`) — the 0.1.x line is dead and everything we want (tiptap 3, editor atoms, shells) is v1-only. Betas ship every 1–3 days; pin and bump deliberately per phase. Merge gated on stable `1.0.0` or team sign-off.
2. **Straight upgrade, no 0.1.278 stopover** — that window has no breaking changes, so the intermediate step adds a QA cycle for nothing.
3. **Lean on the deprecation shims to phase the work** — land the version bump + shim deletion first (app runs with dev warnings), then burn down deprecations in reviewable slices.
4. **Editor: keep wiki's custom extensions, rebuild the *chrome* on `frappe-ui/editor` atoms in this upgrade** (phase 4, details below). Do not adopt `RichTextKit` wholesale.
5. **Shells: full evaluation in phase 5.** Prototype `DesktopShell`/`MobileShell`/`MobileNav`/`PageHeader`/new `Sidebar` against the week-old custom mobile shell (`mobile_friendly_app.md`) plus the `SettingsDialog` family; adopt wherever it's a net code deletion. `SettingsDialog` is the most promising win (our settings modals are hand-rolled).
6. **Land the pending repo-wide biome formatting churn first**, as its own commit/PR, before phase 0 — keeps upgrade diffs reviewable.
7. **Data layer stays on the `createResource` family** — `useCall`/`useList`/`useDoc` out of scope.

## Editor: from shims to atoms

**The user question: "could the tiptap hack now be built on top of frappe-ui editor atoms?" — Yes, and better: the hack simply dies.** The shims never implemented editor features; they only papered over frappe-ui-internals expecting tiptap v2. With frappe-ui v1 on tiptap `^3.26`, we:

- Bump our `@tiptap/*` from `^3.19.0` to `^3.26.0` (align with frappe-ui) — tiptap 3 minor bumps, low risk.
- Delete both shim files, the vite pre-resolver plugin, the tiptap aliases, `optimizeDeps.exclude`, and the prosemirror `resolutions` (v1's tiptap 3.26 pulls consistent prosemirror versions on its own). Keep the `shiki` resolution only if still needed by `@pierre/diffs`.

**Then, separately (phase 4), rebuild the editor chrome on `frappe-ui/editor` atoms.** What v1 exposes (import path `frappe-ui/editor`):

- Engine: `useEditor` composable; headless `Editor` wrapper + `EditorContent` (v0/v1 editors can coexist — irrelevant for us since we never used `TextEditor`).
- Chrome components: `EditorFixedMenu`, `EditorBubbleMenu`, `EditorTableMenu`, `EditorFloatingMenu`, `EditorDropZone` — all take `:items` built from **typed menu-item atoms** (`Bold`, `Italic`, `HeadingGroup`, `InsertLink`, `InsertImage`, table commands, …) or the presets (`articleToolbar`, `tableToolbar`, …).
- Extension kits: `CommentKit` / `RichTextKit` / `InlineKit`, configurable in place; plus à-la-carte extensions (slash-commands, link popup, image, image-group/viewer, video, attachment, iframe-with-allowlist, code-block-lowlight, table with cell color + size picker, TOC node, stable heading IDs, markdown/HTML paste).
- `:upload-function` prop (wire to `useFileUpload().upload`); `import 'frappe-ui/editor-style.css'` (content styled via `prose prose-v3`).

Mapping for wiki:

| Wiki custom code | v1 counterpart | Plan |
|---|---|---|
| `WikiToolbar.vue` (~20 buttons, custom) | `EditorFixedMenu` + menu-item atoms + custom items | Rebuild on atoms; keep wiki-specific items (mermaid, PDF, video embeds) as custom `MenuItem` objects — the atom types are designed for this |
| `WikiBubbleMenu.vue` (tippy + `@tiptap/vue-3/menus`) | `EditorBubbleMenu` | Replace |
| `WikiTableDropdown.vue` | `EditorTableMenu` + table command atoms | Replace |
| `slash-commands.js` | v1 slash-commands extension / `createSuggestionExtension` | Evaluate; keep ours if v1's isn't extensible enough for wiki page links |
| `link-extension.js` + `LinkPopup.vue` | v1 link extension (popup/paste/shortcut) | Evaluate |
| Callout, mermaid, PDF, video, iframe node views | no counterpart (callout/mermaid/PDF), iframe/video exist upstream | **Keep ours** — they're product features; register alongside whatever base we use |
| `wiki-starterkit.js`, markdown support (`@tiptap/markdown`) | `RichTextKit` + content-paste extension | Keep our starterkit for now; kit adoption is a follow-up, not this upgrade |
| `wiki-editor-content.css` | `frappe-ui/editor-style.css` (`prose prose-v3`) | **Risk area**: importing both will conflict. Only import editor-style.css if/when we adopt v1 chrome, and reconcile deliberately |

## Phases (tracer bullets — build + e2e green + commit after each)

**Phase 0 — Branch + pin + boot.**
`feat/frappe-ui-v1` off `upstream/develop`. Pin `frappe-ui` to the current beta (exact). Add `node_modules/frappe-ui/src/molecules/**` to tailwind `content`. Fix whatever breaks the build/boot. Tracer: app boots, login works, a page renders in light + dark.

**Phase 1 — Kill the shims.**
Bump `@tiptap/*` to `^3.26.0`; delete `tiptap-vue-3-shim.js`, `tiptap-shims/*`, `tiptapShimsPlugin`, tiptap aliases, `optimizeDeps.exclude`, prosemirror `resolutions`. Tracer: editor opens, typing/formatting/tables/images/mermaid/PDF all work. This is the highest-value, lowest-risk payoff of the whole upgrade.

**Phase 2 — Tokens codemod.**
`tokens-v2 --dry-run`, review, run once, commit separately (mechanical diff). Visual sweep of both themes, editor content CSS included (`wiki-editor-content.css` uses raw hljs/token classes — audit against the typography shift). Tracer: no visual regressions on Home, SpaceDetails, Contributions, settings dialogs.

**Phase 3 — Deprecation burn-down.**
Dev-warning-driven: Dialog props/slots (11 files), Dropdown `items`→`options` (7), `Autocomplete`→`Combobox` (1 wrapper), `Input`→`TextInput` (2 + main.js), `FeatherIcon`→lucide + drop `feather-icons` dep, Sidebar `sections`→ composable `SidebarItem` API. One commit per component family. Tracer: zero frappe-ui deprecation warnings in dev console on a full click-through.

**Phase 4 — Editor chrome on atoms.**
Per the mapping table: `EditorFixedMenu`/`EditorBubbleMenu`/`EditorTableMenu` with a mix of stock + custom menu items; keep wiki extensions. Reconcile `editor-style.css` vs `wiki-editor-content.css`. Tracer: full editing e2e suite green; mobile toolbar still usable (h-scroll behavior from mobile spec preserved or replaced by `EditorFixedMenu`'s own responsive handling).

**Phase 5 — Shells + settings (evaluate, adopt selectively).**
Prototype `SettingsDialog` family for space settings; evaluate `DesktopShell`/`MobileShell`/`MobileNav`/`PageHeader`/new `Sidebar` against `MainLayout`/`MobileTopNav`/`MobileDrawer`. Adopt only where it's a net code deletion. Possibly adopt `ThemeSwitcher`. Tracer: mobile Playwright project green at 375px.

## Risks

- **Beta churn** (release every 1–3 days): pin exact; bump once per phase, read `v1-release/changelog.md` diff each bump. Don't ship to production until upstream cuts stable `1.0.0` — or accept beta with pinning (Frappe's own apps are already on it; decide at phase 3).
- **tokens-v2 codemod is not idempotent** — run exactly once, on a clean tree, as its own commit. Post-beta.11 typography shift is included in current codemod.
- **CSS collision** between `frappe-ui/editor-style.css` (`prose prose-v3`) and `wiki-editor-content.css` — deferred to phase 4, imported only then.
- **Tailwind content globs**: v1 moved sources (`src/molecules/**`); missing globs fail silently (unstyled icons). Verify against the beta's actual layout at phase 0.
- **Public reader untouched**: `wiki/templates/wiki/` (Jinja/Alpine) doesn't consume frappe-ui — but `wiki-editor-content.css`-derived styles served to the reader must be re-verified after phase 2.
- Working tree currently has an uncommitted repo-wide formatting churn (quote style) across 37 frontend files — land or discard that before phase 0 so upgrade diffs stay reviewable.

## Progress log

- 2026-07-04: Spec written; decisions settled with the user (see Decisions). Implementation started.
- 2026-07-04: Pre-work — repo-wide biome formatting churn landed separately (PR #694, `chore/biome-format`); an unrelated in-flight `header.html` search-button redesign was preserved in a git stash ("wip: public reader search button redesign").
- 2026-07-04 Phase 0 ✅ (`feat/frappe-ui-v1`): pinned `frappe-ui@1.0.0-beta.20` exact; added molecules glob to tailwind content. Build green on first try; app boots.
- 2026-07-04 Phase 2 ✅ (promoted ahead of shim removal — renamed tokens resolved to nothing and main surfaces went white in dark mode): tokens-v2 codemod, 38 files, 67 renames + 64 typography merges. Both themes verified pixel-consistent. Pre-existing (not upgrade): ContributionBanner uses raw `bg-gray-50`, not theme-aware.
- 2026-07-04 Phase 1 ✅: shims deleted, tiptap → ^3.26. **Gotcha:** the prosemirror `resolutions` are load-bearing dedupe, not part of the shim hack — dropping them yields duplicate prosemirror-model/state and "Adding different instances of a keyed plugin". Kept, bumped to current versions. 18/18 e2e green.
- 2026-07-04 Phase 3 ✅: Dialog (11 files), Dropdown grouped `items`→`options`, Input→TextInput, FeatherIcon→lucide, dropped direct `feather-icons` dep. frappe-ui Autocomplete turned out to be unused (wiki has its own dialog-safe wrapper) — no Combobox migration needed. Note: v1 Button still renders bare feather icon-name strings (with dev warning), so remaining `icon-left="x"` usages keep working. 16/16 dialog-heavy e2e green.
- 2026-07-04 Phase 4 ✅: toolbar → `EditorFixedMenu` + atoms, bubble menu → `EditorBubbleMenu` (kept mobile suppression + scroll-boundary flip logic), WikiTableDropdown deleted → floating `EditorTableMenu` + `InsertTable` size picker. `InsertLink` atom calls `openLinkEditor()` — wiki's link extension already defines it, zero glue. Custom MenuItem objects for task list, code block, image (file input), PDF, video (wiki's node is `videoBlock`, stock atom gates on `video` and hides). Net −560 lines. e2e: toolbar buttons expose aria-label not title (1 selector updated). 21 editor e2e green.
- 2026-07-04 Follow-up ✅: **public reader now shares frappe-ui tokens.** `scripts/generate-public-theme.mjs` reads the same Figma-synced JSONs the SPA preset reads (`frappe-ui/tailwind/colors.json` — the live oklch file, NOT `generated/colors.json` which is a stale hex export) and emits `wiki/public/css/frappe-ui-tokens.css` (Tailwind v4 `@theme` + `:root`/dark semantic vars + `@utility` text-style/focus-ring classes). Runs as part of `yarn tailwind:build`; output gitignored like tailwind.css. Hand-copied token blocks deleted from `theme.css`; tokens-v2 codemod run on `wiki/templates` (surface-white→surface-base, surface-modal→surface-elevation-2, surface-menu-bar→surface-sidebar, typography merges). Mirrors upstream `colorPalette.js`/`plugin.js` semantics — node can't import those directly (bare JSON imports).
- 2026-07-04 Phase 5b ✅ (revisited per user, after studying Gameplan PR frappe/gameplan#514): **shells adopted after all.** MainLayout → `DesktopShell` (#sidebar slot) / `MobileShell` (+ bottom `MobileNav`: Spaces, Change Requests). The `#app-header` teleport system + MobileTopNav + `mobileHasLeadingControl` deleted; pages declare headers via `PageHeader`/`PageHeaderMobile` into the shells' PageHeaderTarget (SpaceList, Contributions, ContributionReview, SpaceDetails-mobile; new `MobileAppMenu` hosts Settings/Theme/Logout in mobile header right slot). Gameplan-style polish: desktop content column floats as a rounded card over `surface-sidebar` (flat + border-l in dark). Pages keep their own inner scroll regions (wiki pages are app-like, not content-flow) — the shell viewport gets an explicit `height:100%` fix for reka ScrollArea's `display:table` wrapper. Gotcha: frappe-ui Button sets `aria-label` from its `label` prop, clobbering a plain `aria-label` attr on icon-only buttons — use `:label`. e2e updated (tree-toggle selector), 43 specs green incl. mobile projects.
- 2026-07-04 Phase 5 ✅: global Sidebar → composition API (SidebarHeader/SidebarItem/SidebarCollapseToggle). WikiSettings + SpaceSettings → SettingsDialog family (real ARIA tablist, mobile full-screen, arrow-key nav); e2e updated for role=tab. **Skipped deliberately:** `DesktopShell`/`MobileShell`/`PageHeader` — they're thin wrappers whose value is the PageHeader-teleport + shared scroll-container registry; adopting them means migrating every page's inline header for no user-visible gain over the week-old custom mobile shell. Revisit if/when a feature needs `useScrollContainer`. `ThemeSwitcher` skipped — the sidebar-menu toggle covers it.
- 2026-07-05 Reuse follow-ups ✅ (logged retroactively; commits 540cc5c…a54de85): WikiCodeBlock → frappe-ui `CodeBlock` extension; frappe-ui editor baseline styles adopted, wiki-editor-content.css deduplicated (514→145 lines); public search modal restyled on the docs CommandPalette; ghost icon buttons + labelled search trigger in public header; settings panels styled on SettingsDialog patterns. Upstream PR frappe/frappe-ui#824 opened: `format: 'markdown'` + `Markdown` re-export for `useEditor`/`<Editor>`.
- 2026-07-09 Markdown-format refactor ✅ (frappe/frappe-ui#824 merged 2026-07-08): WikiEditor + WikiContentViewer now run on frappe-ui's `useEditor` with `format: 'markdown'` and frappe-ui's `EditorContent`; hand-wired `contentType: 'markdown'`, manual destroy/editable plumbing, and the viewer's content watch all deleted. `Markdown` extension imported from `frappe-ui/editor` everywhere (direct `@tiptap/markdown` dep kept only for `MarkdownManager` in the link-markdown unit test). **Pinned `frappe-ui` to the merge commit (`frappe/frappe-ui#021ef66…`) — npm beta.21 (2026-07-05) predates the merge; re-pin to beta.22 when it ships.** Gotchas: (1) `@tiptap/vue-3`'s `EditorContent` never mounts a frappe-ui `useEditor` editor — it guards on `editor.options.element`, which useEditor sets to null; frappe-ui's own `EditorContent` is required (it also wires `contentComponent`/`appContext` so `VueNodeViewRenderer` node views keep working). (2) `useEditor` takes no `editorProps` — set `handlePaste`/`handleDrop` via `editor.setOptions()` after creation. (3) useEditor destroys the editor in its own `onBeforeUnmount`, so WikiEditor's final content flush is registered `onBeforeUnmount` *before* the `useEditor()` call (hooks run in registration order). (4) **frappe-ui/editor's side-effect `style.css` is chunk-assigned by rollup wherever it likes — after the refactor it landed only in the ContributionReview chunk, leaving editor pages without task-list/tableWrapper/resize styles. Fixed with an explicit `@import "frappe-ui/editor-style.css"` in index.css; don't rely on the side-effect import.** Per user call, editor typography is now frappe-ui's out-of-the-box `prose prose-v3` (EditorContent default): dropped wiki's `prose-sm` + prose-code/prose-a override classes and deleted the duplicated font/inline-code/blockquote/hr rules from wiki-editor-content.css. Verified: 26 unit tests green (one stale assertion relaxed — upstream corruption shape for underlined links changed across @tiptap/markdown releases), 37-spec editor e2e slice + CR-flow (16) + mobile (4) green serially. Known: image-viewer ×3 fail locally with a `version_conflict` submit gate — pre-existing (fails identically on a pre-refactor build), needs separate triage. Follow-ups: adopt `RichTextKit` once wiki's custom nodes have upstream renderMarkdown/parseMarkdown parity; public reader typography still pre-prose-v3 — revisit parity.
- 2026-07-09 Skill-compliance pass ✅ (frappe-ui skill rules enforced on the frontend, priority order): **R3 tokens** — all raw palette classes → semantic trios (banner/conflict UI now theme-correct in dark mode; overlays on black/white-overlay tokens; links on ink-blue-link; image-scrim spinner keeps text-white deliberately). **R12** — uppercase diff-header labels dropped. **R2** — legacy `ListView` → `frappe-ui/list` family in SpaceList + ContributionsPanel (descriptor widths → grid tracks, `getRowRoute` → `ListRow :to`, app-authored empty states; `list-style.css` imported explicitly — same rollup chunk trap as editor css). **R8** — all ~80 per-icon Vue imports (`~icons/lucide/*` + `lucide-vue-next`) → CSS-class icons across 24 files; `lucide-vue-next` dep dropped; gotcha: prefix-collision in the conversion regex mangled `LucideImagePlus`/`LucideFolderPlus` (fixed; validated every conversion against HEAD~1). **R1 audit** — all 23 remaining raw `<button>`s judged structural (disclosure headers, listbox options, editor node-view chrome, dropzones, input-suffix clears, tree hover actions); no conversions. e2e green serially throughout; sidebar/mermaid stuck-overlay failures re-confirmed pre-existing (fail identically on pre-change build; CI green).
- 2026-07-09 (later): develop merged in (conflicts were formatting-echoes of squash-merged #694 — resolved with ours across the board; only real develop frontend change was the new markdown-paste.test.js, which runs fine on the branch). CI on the PR (CI + UI Tests + Linters) fully green after the merge push — confirming the image-viewer `version_conflict` failures are local-env only. Public reader prose-v3 parity done as its own spec: `specs/public_reader_prose_v3.md`.
- 2026-07-24 Re-pin to release ✅: `frappe-ui` moved off the `#021ef66…` merge-commit pin to the published release `1.0.0-beta.25` (PR #824's markdown-format feature is in it — beta.25 is 13 commits ahead of the pinned merge, 0 behind). Span 021ef66→beta.25 is all fixes, no breaking changes (notable: #831 dialog focus-loss on outside pointerdown, #834 circular-chunk imports, #843 Tree hover, #844 TextEditor suggestion popup, #847 ErrorMessage sanitize). Build green.
