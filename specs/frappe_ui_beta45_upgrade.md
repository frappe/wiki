# Frappe UI `beta.25` → `beta.45` Upgrade

Date: 2026-08-11
Status: **Planned — not started.**
Research base: frappe-ui `v1.0.0-beta.25` (2026-07-20, what we ship) vs `v1.0.0-beta.45` (2026-08-10, npm `beta`). 696 upstream commits. Reference upgrade: [frappe/gameplan#543](https://github.com/frappe/gameplan/pull/543) (beta.36 → beta.43).

Sources: `docs/content/docs/migration.md` and `docs/content/docs/changelog.md` at `v1.0.0-beta.45` (the changelog moved out of `v1-release/changelog.md` in #1031), diffed against the same files at `v1.0.0-beta.25`. 76 new changelog entries in the delta.

## Goal

Move `frontend/package.json` from `frappe-ui@1.0.0-beta.25` to `1.0.0-beta.45`, absorb every break that touches wiki, and keep the public reader's vendored token CSS in sync.

## Delta inventory

Everything below is new since `beta.25`. **Hit** = wiki has call sites. **Loud** = build/import fails. **Silent** = renders wrong with no error.

### A. Loud breaks that hit us

| # | Change | Wiki call sites |
|---|---|---|
| A1 | `frappe-ui/list-style.css` and `frappe-ui/editor-style.css` exports removed — the `frappe-ui/list` and `frappe-ui/editor` barrels are side-effectful now and ship their own CSS | `frontend/src/index.css:7,9` — delete both `@import`s |
| A2 | `Autocomplete` removed — split into `Combobox` (single) and `MultiSelect` (multiple) | `components/AssignDialog.vue` (uses `multiple` → `MultiSelect`). `components/SpaceList.vue` uses our *local* `components/Autocomplete.vue`, which is hand-rolled and unaffected |
| A3 | `pageMetaPlugin` removed | `main.js:20,45` — delete the import and `app.use`. `usePageMeta` (already used in `pages/Spaces.vue`) is the replacement |
| A4 | Node floor `>=20.19.0` via `engines` | local is v24.15.0 ✓; check CI images |

### B. Silent breaks that hit us

| # | Change | Wiki call sites |
|---|---|---|
| B1 | **Radius aliases removed.** `rounded`/`-sm`/`-md`/`-lg`/`-xl`/`-2xl` emit no CSS (preset replaces Tailwind's `borderRadius`). Map: `rounded→4`, `sm→1`, `md→5`, `lg→6`, `xl→7`, `2xl→8`. `rounded-none`/`-full` kept. `var(--radius-sm\|md\|lg\|xl\|2xl)` also dies | ~398 bare `rounded`, 114 `-lg`, 95 `-md`, 30 `-sm`, 13 `-xl`, 1 `-2xl`, plus directional `rounded-t/r/l/b/tl/tr`. Codemod handles most; bare `rounded` inside multi-line template literals is missed |
| B2 | **Chromatic ink scales shift one level.** New `ink-red-1` is old `ink-red-2`, all 11 chromatic families, scales end at `-9`. `ink-gray` does **not** shift. Old `-1` was white → manual, usually `text-white` | ~130 `text-ink-{red,green,amber,blue,violet,orange}-N` sites; `-1` sites exist (`ink-violet-1`, `ink-red-1`, `ink-green-1`, `ink-blue-1`, `ink-amber-1`) and need manual fixes |
| B3 | `Dropdown`/`ContextMenu`: `placement` prop ignored (falls back to `align="start"`); `{group, items}` → `{group, options}`; `component:` rows → `slots: { item }` | `components/MobileAppMenu.vue:2` (`placement="right"` → `align="end"`), `components/tiptap-extensions/CalloutBlockView.vue:335` (`placement="bottom-end"` → `align="end"`) |
| B4 | `PageHeaderMobile` `#left`/`#right` → `#prefix`/`#suffix`; `PageHeaderMobileTitle` `#icon` → `#prefix` | `components/SpaceList.vue:7` (`#right`), `pages/SpaceDetails.vue:9` (`#left`), `:15` (`#icon`), `pages/Contributions.vue:5` (`#right`) |
| B5 | **`Tabs` replaced by a composed family** `Tabs`/`TabList`/`TabTrigger`/`TabPanel`. Model is the trigger `value`, never an index. Layout defaults (`flex flex-1 overflow-hidden`, panel `overflow-auto`) are gone | `pages/Contributions.vue:30` — `v-model="activeTabIndex"` + `:tabs` + `#tab-panel`. Index model must become the tab key; check panel scrolling |
| B6 | **`useFileUpload()` / `FileUploadHandler` default to private.** An upload with no stated `private`/`is_private` now uploads `is_private=1` | `components/PageSettings.vue:175`, `components/WikiEditor.vue:142`, `components/SpaceSettings/GeneralPanel.vue:123`. **Audit each** — editor images and space/page cover images are served to the public reader with no session; a flip to private returns 403 |
| B7 | `Combobox`: `reset()` on a template ref → `clear()` | `components/SpaceSettings/PermissionsPanel.vue:263` |
| B8 | `Sidebar` no longer wraps the middle list in a scroll container or applies padding (app-owned); `SidebarHeader` `#logo` → `#prefix` | `components/Sidebar.vue` already composes and owns its own padding/scroll — verify visually, likely no change |
| B9 | `FrappeUI` plugin: `$resources` Options-API mixin no longer installs by default (`app.use(FrappeUI, { resources: true })`); `config`/`call`/`socketio` options removed | `main.js:44` installs `resourcesPlugin` directly, which still works. No component declares an Options-API `resources` block. Confirm with a grep before dropping |
| B10 | `Tooltip`: `placement` → `side`, `arrowClass` → `offset`/`[data-slot="arrow"]`, `#body` → `#content` | No hits — `components/AssigneeAvatars.vue` uses `text` only ✓ |
| B11 | Unused tokens removed: `text-tiny`, `text-13xl`–`text-16xl`, `shadow-status`, `--elevation-status`, `surface-alert-button-*`, `ink-alert-button-*`, `surface-alpha-gray-2-overlay` | No hits in `frontend/src` (only in built assets) ✓ |
| B12 | `Select`: `displayValue` trigger slot prop → `selectedOption.label` | `components/SpaceSettings/PermissionsPanel.vue:44` — check the trigger slot |
| B13 | Editor: media captions moved off `alt` to a `caption` attribute (`data-caption`); the editor no longer edits `alt` | Wiki ships its own `components/tiptap-extensions/image-extension.js` with caption support. Verify no collision with the frappe-ui editor's image handling |

### C. Moved to subpaths (loud, no wiki hits)

- `ListView` family → `frappe-ui/experimental`. **Our `frappe-ui/list` imports (`SpaceList.vue`, `ContributionsPanel.vue`) are the new List family and stay put.** ✓
- `Calendar` family → `frappe-ui/experimental`.
- Sprite `Icon`/`IconPicker`/`spritePlugin`: `frappe-ui/icons` → `frappe-ui/experimental`. Named SFC icons stay on `frappe-ui/icons`. Wiki's `components/IconPicker.vue` is our own ✓.
- v0 `TextEditor` family removed from root, parked in `frappe-ui/experimental`. Wiki is already on `frappe-ui/editor` ✓.
- `frappe-ui/frappe` and `frappe-ui/drive` subpaths deleted.
- `code-editor` subpath folded into `experimental`.
- `./hljs-theme.css` export removed — wiki owns its highlighter already ✓.

### D. Removed components (no wiki hits)

`Input`, `FeatherIcon`, `Card`, `ListItem`, standalone `<Toast>`, `MonthPicker`, `CircularProgressBar`, `GridLayout`, `NestedPopover`, `ListFilter`, `SearchComplete`. `FormControl type="autocomplete"` removed (silent — falls through to a text input).

### E. Redesigns / renames worth knowing (no current hits)

- **`Alert` redesigned for espresso 2.0**: stateless (no `v-model`, `v-if` + `@dismiss`), `theme="yellow"`→`"amber"`, default theme `gray`, `dismissible` defaults `false`, `variant` gone, `#icon`→`#prefix`, `#footer`→`primaryAction`/`secondaryAction`/`#actions`. Wiki registers `Alert` globally in `main.js` but has **zero `<Alert>` call sites** — drop it from the global registration.
- `useTheme` → `useColorScheme` (`currentTheme`→`colorScheme`, read-only; `setTheme`→`setColorScheme`). Wiki's `composables/useTheme.js` is entirely local, no frappe-ui dependency ✓. beta.44/45 added a built-in transition mute across scheme swaps — potential future replacement for our `.no-transition` hack in `index.css`.
- Nine scroll members → `shellScrollContainer` + `useShellScrolled`; `useIsMobile`/`useScreenSize` un-exported. Wiki's `composables/useMobile.js` is local ✓.
- `PageHeaderBackButton`: `to` is now a fallback used only when there is no in-app history.
- `Popover` v0 API removed (`#target`→`#trigger` with reka wiring, `placement`→`side`+`align`, `show`→`open`, `#body`→`#default`+`bare`). Wiki uses reka-ui `PopoverRoot` directly in `IconPicker.vue` ✓.
- `TabButtons`: `type`→`variant`, `buttons`→`options`, `value` required per option, new `fluid`. Sliding indicator animation on both `Tabs` and `TabButtons`.
- `CommandPalette`: `show`→`open`. `KeyboardShortcut`/`useShortcut` surface trimmed.
- `DatePicker`/`TimePicker`/`DateRangePicker`: footer removed, `#actions` sidebar slot, `DateRangePicker` emit shape, deprecated aliases gone.
- Data fetching v2 (`useCall`/`useDoc`/`useList`/`useNewDoc`): one request per submit, `submit()` rejects on failure, `data` no longer cleared on failure, `error` no longer cleared on start, `isLoading(id)` replaces `params`-sniffing, `useFrappeFetch` un-exported, `FrappeResponseError` exported, a throwing `beforeSubmit` now cancels the submit. **Wiki is entirely on `createResource`/`createListResource`/`createDocumentResource`, which are unchanged** ✓.
- `frappeRequest` fixes: `onError` fired twice per failure; method names starting with `http` skipped the `/api/method/` prefix; `login` returned only `message` under `requestBaseUrl`.
- `createListResource`: `hasPreviousPage` was stale after `reload()`.
- `Dialog`: sibling-mount host dedup; the stack survives duplicate package copies (beta.43). May interact with our `dialog-overlay { animation: none }` workaround — retest the stuck-overlay class before keeping it.
- `Button`: solid red label contrast raised.
- Portal target: `usePortalTarget`/`providePortalTarget`/`portalTargetKey` for embedded hosts.
- `SidebarCard` — new promotional card component.
- `Charts` — new family at `frappe-ui/charts` with its own `--chart-*` tokens.

### F. Build / tooling

| Change | Action |
|---|---|
| `frappe-ui/tailwind` now exports `content` — the authoritative glob list | `frontend/tailwind.config.js` hand-maintains `src/components/**` + `src/molecules/**`, which **already drops classes the editor and list molecules emit**. Spread the export instead |
| `frappe-ui/tailwind` `tokens.js` export removed | Not imported directly ✓, but `scripts/generate-public-theme.mjs` reads `frontend/node_modules/frappe-ui/tailwind` — verify it still resolves |
| `wiki/public/css/frappe-ui-tokens.css` is generated from the installed frappe-ui | Regenerate via `yarn tailwind:build` after the bump. Header still says `beta.25`; the radius aliases it emits go away |
| `@tiptap/markdown` | Gameplan hit this: beta.43+ pulls `@tiptap/markdown@3.28.0`, which demands an exact `3.28.0` core and breaks against existing pins. Wiki has `^3.26.0` on every tiptap package — pin `@tiptap/markdown` to `3.26.0` or move the whole tiptap set to 3.28.0 together |
| `reka-ui ^2.10.1` resolution + prosemirror resolutions in `package.json` | Load-bearing today. Re-check whether beta.45 makes them redundant; do not drop them blind |

## Codemods

Two separate, **non-idempotent** runs. Both must land in the same commit as the version bump — the codemod without the upgrade renders wrong, and so does the upgrade without the codemod.

```sh
cd frontend
npx --package frappe-ui@beta tokens-v2 --dry-run .          # radius renames
npx --package frappe-ui@beta tokens-v2 .

npx --package frappe-ui@beta tokens-v2 --ink-shift --dry-run .
npx --package frappe-ui@beta tokens-v2 --ink-shift .
```

`--ink-shift` writes a `.tokens-v2-ink-shift` marker in each target directory and refuses to run again while it exists. **Commit the marker** — on a fresh clone without it the guard is gone and a re-run double-shifts. Run it on `frontend/` (and separately on any other real package root); do not let it walk into `node_modules`.

Neither codemod touches `wiki/public/**` or `wiki/www/**` — the public reader's hand-written CSS and Jinja templates need a manual radius/ink sweep.

## Phases

Tracer-bullet order: get the build green first, then fix silent breaks by blast radius, then verify.

**Phase 0 — Branch and baseline.** `git fetch upstream develop`, branch `feat/frappe-ui-beta45` off `upstream/develop`. Commit this spec first. Record a `yarn build` baseline and screenshots of the sidebar, editor, settings dialog, contributions tabs, and public reader.

**Phase 1 — Bump and make the build compile.** Bump to `1.0.0-beta.45`, pin `@tiptap/markdown` as needed, delete the two CSS `@import`s (A1), delete `pageMetaPlugin` (A3), drop `Alert` from the global component registration (E), spread the preset's `content` in `tailwind.config.js` (F). Build must pass. Confirm editor and list CSS still land in the output (grep the built CSS for ProseMirror and list rules, as gameplan did).

**Phase 2 — Tokens.** Run both codemods on `frontend/`, commit the marker, grep for leftovers:
```sh
grep -rnE "rounded(-(sm|md|lg|xl|2xl))?\b" frontend/src        # bare rounded in template literals
grep -rn -- "--radius-\(sm\|md\|lg\|xl\|2xl\)" frontend/src wiki/public wiki/www
grep -rnE "ink-(red|green|amber|blue|violet|orange|teal|pink|purple|cyan|yellow)-1\b" frontend/src
```
Manual radius/ink sweep of `wiki/public/css/*.css` and `wiki/www/**`. Regenerate `frappe-ui-tokens.css`. Visual diff against the Phase 0 screenshots — B1 and B2 are the only changes in this phase, and both are pure-visual.

**Phase 3 — Component API breaks.** One commit per item, ordered by blast radius:
1. B6 `useFileUpload` privacy audit — pass `private: false` explicitly wherever the file is served to the public reader. **Do this before anything cosmetic; it is the one break that can silently 403 published content.**
2. A2 `Autocomplete` → `MultiSelect` in `AssignDialog.vue` (v-model payload inverts to a value array).
3. B5 `Tabs` composed family in `pages/Contributions.vue` (index model → key model, restore the layout defaults the panel relied on).
4. B3 `Dropdown` `placement` → `align` (2 sites).
5. B4 `PageHeaderMobile` slot renames (4 sites).
6. B7 `Combobox.reset()` → `clear()`, B12 `Select` trigger slot.
7. B8/B13 verification passes.

**Phase 4 — Verify.** `yarn build`, `yarn test`, Playwright e2e with `BASE_URL=http://wiki.localhost:8000`. Manual pass on: sidebar collapse, editor (image upload, captions, toolbar, bubble menu), settings dialogs, contributions tabs, mobile shell headers, public reader in both themes. Re-test the stuck-dialog-overlay class (memory: `project_sidebar_spec_flake`) to see whether beta.43's dialog-host fixes let us drop the `animation: none` override.

**Phase 5 — PR.** Against `frappe/wiki` `develop`. Sanity-check `git diff --stat upstream/develop..feat/frappe-ui-beta45` is only our files.

## Decisions (2026-08-11)

1. **Go to `beta.45` now**, not wait for `1.0.0` final. The delta only grows, and gameplan is already past beta.43.
2. **Bump the whole tiptap set**, do not pin `@tiptap/markdown` back. `@tiptap/markdown` declares *exact* peers on `@tiptap/core` and `@tiptap/pm` at its own version, so the set has to move together. Target `^3.29.2` (latest). frappe-ui `beta.45` declares `^3.26.0` on every tiptap package, so 3.29.2 satisfies it; add `resolutions` for `@tiptap/core` and `@tiptap/pm` if yarn ends up with two copies.

## Open question

- Does `--ink-shift` need to run over `wiki/public` and `wiki/www` too, or is a manual sweep safer given the marker's one-shot semantics?
