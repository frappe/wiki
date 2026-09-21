# Frappe UI `beta.55` → `beta.76` Upgrade

Date: 2026-09-21
Status: **Draft, not started.**
Research base: frappe-ui `v1.0.0-beta.55` (what `frontend/package.json` ships) vs `v1.0.0-beta.76` (npm `beta`, the current tag). Sources: `docs/content/docs/changelog.md` and `docs/content/docs/migration.md` at both tags, diffed. The changelog delta is 66 entries; the migration delta is larger because it also documents older v0 breaks that were written up late, so the changelog delta is the list of things that actually changed under us.

## Goal

Move `frontend/package.json` from `frappe-ui@1.0.0-beta.55` to `1.0.0-beta.76`, absorb every break that touches wiki, and keep the public reader's vendored token CSS in sync.

Not a telemetry prerequisite. `@framework/ui/telemetry` needs only `call` from frappe-ui, which beta.55 already exports, and the telemetry work links `@framework/ui` without this upgrade. The reason to do it is to stop drifting: every release we skip makes the next jump wider, and new frappe-ui work (charts, list, editor, shells) lands only on the current tag.

## Delta inventory

**Hit** = wiki has call sites. **Loud** = build or type-check fails. **Silent** = renders or behaves wrong with no error.

### A. Loud breaks that hit us

| # | Change | Wiki call sites |
|---|---|---|
| A1 | `resolvedColorScheme` is no longer a function export. It is a read-only ref on `useColorScheme()`, and the `MutationObserver` around it goes away | `composables/useTheme.js:1,28,32` |

### B. Silent breaks that hit us

| # | Change | Wiki call sites |
|---|---|---|
| B1 | **`text-*` line height moves from 1.15 to 1.35.** frappe-ui's own components carry `leading-tighter` and keep their height; our markup does not. Fixed-height rows can clip or sit off-centre, and content-sized rows grow 2.4 to 5px each | Every hand-written row: tree rows, sidebar items, search results, toolbar chrome, mobile nav. Fix is `leading-tighter` on single-line chrome in a fixed box, `text-p-*` for prose |
| B2 | **`Tree` expansion moves to a keyed `v-model:expanded`** and the component stops writing `expanded` on your nodes | `components/WikiTree.vue:2,98,181-185` reads and writes `node.expanded` by design, and `useTreeDialogs` auto-expand writes the same field |
| B3 | `ListGroup` `#header` slot is `#label`. Vue drops content under an unknown slot name, so the group header just disappears | `components/ContributionsPanel.vue:85` |
| B4 | `Dialog` `icon` takes a `lucide-*` string or a component, and the tone moves to a top-level `theme`. An object renders an empty icon badge | `components/SubmitForReviewButton.vue:28` (`:icon="{ name: 'lucide-git-branch', theme: 'blue' }"`) |
| B5 | **Editor menu options are a fixed set**: `side`, `align`, `strategy`, `offset`, `flip`, `shift`, `hide`, `inline`, `scrollTarget`, `shouldShow`. `placement` splits into `side` plus `align`; `flip` and `shift` in object form are gone, `true` or nothing; the Floating UI derivable boundary we pass is not a supported key. `scrollTarget` is the replacement for pinning to a scroll container | `components/tiptap-extensions/WikiBubbleMenu.vue:119-140`, which pins the flip/shift boundary to the editor's scroll container and pads it by the toolbar height. This is the one real design change in the upgrade: see Phase 2 |
| B6 | `frappe-ui/list` row state vocabulary: `[data-slot='list-row'][data-active]` is `[data-state='active']`, and `data-state="selected"` is `data-selected` | One file carries a `data-state` selector; `npx list-v1 .` covers the anchored forms, the rest is a grep |
| B7 | Tailwind preset: `hover:` applies only where hovering is possible | Any hover-only affordance on touch. Visual check on the mobile specs |
| B8 | Writes reject instead of resolving `null` across the data-fetching composables, and an unawaited write becomes an unhandled rejection | We use `createResource` / `createListResource` / `createDocumentResource` in 24 files. Audit every `if (!result)` after a submit, and every unawaited `.submit()` |

### C. Changed, but no wiki call sites

Checked and clear, recorded so the next upgrade does not re-check them: `is_private` uploads (both call sites already pass `private: false`), `FrappeRequestError` → `FrappeResourceError`, `FrappeUIError`, `ScrollBar`, `useSheetDrag`, `useShellScrolled`, `FrappeUIProviderProps`, `--mobile-header-height`, `Rail` / `RailItem`, `Button.rootRef`, `ThemeSwitcher`, `CommandPalette` (ours is local), root `CommandPalette` removal, `DatePicker` internals, `formatShortcutLabel` / `getActiveShortcuts`, `KeyboardShortcutsModal`, Toast compat shims (we call `toast.success` / `toast.error`), `TabButtons` option `class` (no option carries one), editor suggestion `component:` (we wire our own slash menu), `Select` empty value (no `undefined` compares against a Select model), chart event renames (no `@datapoint-click` / `@slice-click` / `#tooltip` / `#center` / sparkline `type: 'line'` / `showPercentages`), `size="xl"` on an input (our one hit is `Dialog size="xl"`, which keeps its own scale), Tailwind preset path (already `frappe-ui/tailwind`), `lucideIcons` (already `true` in `vite.config.js`), `tailwindcss` peer `>=3.4.2 <4` (frontend is on `^3.4.15`).

## Plan

Tracer bullet order: make it build, make it run, then fix what renders wrong.

### Phase 0: pin and build

Bump `frontend/package.json` to `1.0.0-beta.76`, `yarn install`, run the codemods frappe-ui ships, and get `yarn build` green. Codemods, each idempotent and run with `--dry-run` first: `packaging-v1`, `list-v1`, `navigation-v1`, `base-props-v1`, `editor-v1`, `tokens-v2`, `data-v1`, `overlays-v1`, `destinations-v1`, `shortcuts-v1`. Review every diff they produce: they are a starting point, not the fix.

### Phase 1: loud breaks

A1, plus whatever the build names. Done when `yarn build` and the dev server both come up clean and the SPA renders.

### Phase 2: silent breaks

B2 to B6, in that order. B5 needs a decision rather than a rename: the bubble menu currently pins the Floating UI flip and shift boundary to the editor's scroll container so a selection under the sticky toolbar flips the menu below instead of hiding it behind the toolbar. With the object form gone, the options are `scrollTarget` plus `flip: true`, or mounting TipTap's own `BubbleMenu` and rendering `EditorFixedMenu` inside it. Try `scrollTarget` first and keep the existing e2e coverage honest: `bubble-menu.spec.ts` is what says whether the menu still flips.

### Phase 3: typography and visual sweep

B1 and B7. Walk the reader and the SPA at desktop and phone width, with before and after screenshots of the tree, the sidebar, the toolbar, the mobile nav and the search results. Add `leading-tighter` where a row is fixed-height, and `text-p-*` where the text is prose.

### Phase 4: verification

Full Playwright run against `wiki.localhost`, compared to the pre-upgrade reference run, plus the unit tests. Everything that was green stays green.

## Testing

- Reference run before the bump: 167 tests, the number this branch must match.
- `enable_view_tracking` must be **off** on the test site. With it on, frappe's `make_view_log` call keeps a request pending on the dev server and every `waitForLoadState('networkidle')` in the suite times out. That is 46 failures with one cause and nothing to do with frappe-ui.
- `yarn build` plus the dev server, because the dev path aliases frappe-ui differently from the build path.
- Screenshots per Phase 3, before and after, desktop and phone.

## Open questions

1. **Bubble menu boundary (B5).** Does `scrollTarget` reproduce the toolbar-aware flip, or do we mount TipTap's `BubbleMenu` ourselves? Decided while building Phase 2.
2. **Typography blast radius (B1).** 1.15 to 1.35 touches every hand-written row in the app. If the sweep grows past a day, ship Phases 0 to 2 and take B1 as its own PR, since it is a rendering change with no API in it.
3. **`@framework/ui` peer floor.** The telemetry work links `@framework/ui`, whose peer range is `frappe-ui >=1.0.0-beta.63`. After this upgrade that range is satisfied honestly rather than by only importing the telemetry subpath.

## Progress log

- 2026-09-21: Spec drafted from the beta.55 to beta.76 changelog and migration diff, with the wiki call-site inventory.
