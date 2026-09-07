# Space Avatar: Upload, Icon or Generated Art

Date: 2026-09-01, rewritten 2026-09-07
Status: **Planned.** Renders in spec 01's sidebar; the picker lives in spec 02's
settings dialog, which has landed.
Reference implementation: `apps/bwh_hive` — `frontend/src/lib/dicebear.ts`,
`components/common/IdentityAvatar.vue`, `components/common/IdentityPicker.vue`.

## Problem

A space's identity today is `app_switcher_logo` (an upload) or a bare initial.
The settings row for it is a rectangular preview next to an Upload button, and
the sidebar, overview and space header all render rows of gray initials because
most spaces will never get a hand-made logo.

## Goal

Three ways to give a space a face, picked in one control hung off a square
preview tile: **upload an image**, **pick a lucide icon on a tinted square**, or
**shuffle a generated abstract mark**. Everything that shows a space renders the
same mark through one component — library sidebar, space sidebar header,
overview rows, the public reader header, and the generated social card.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Trigger | The preview tile *is* the control: a square (`size-10`), clickable, opening a popover. The Upload and Replace buttons next to it go away; Remove moves inside the popover. |
| 2 | Popover shape | frappe-ui `Popover` + `TabButtons`: **Upload** \| **Icon**. Proven inside a `SettingsDialog` — hive uses the same pair on the same frappe-ui (beta.55) in `CreateProjectDialog`. `IconPicker.vue`'s `inline` escape hatch exists for a *raw reka* `PopoverRoot`, which portals elsewhere; it is not needed here. |
| 3 | Icon tab | Colour swatch row (the tile drawn in each tint, so the row doubles as a preview) + the icon grid + one full-width **Shuffle** button under it. Hive's layout, minus the style and variant `Select`s. |
| 4 | Icon set | `TAB_ICONS` from `lib/tabIcons.js`, unchanged and unextended. That list is already the SPA's Tailwind safelist *and* the input to `scripts/generate-public-lucide.mjs`, so reusing it means a space icon renders on the public reader with no new generation step. A separate curated list would need adding to both. |
| 5 | Palette | `gray, blue, green, amber, red, violet` — exactly frappe-ui's `AvatarTheme` union, so a space colour can only ever resolve to a tint the design system ships. All six exist as `--surface-*-2` / `--ink-*-7` in the reader's Tailwind v4 build too. |
| 6 | Shuffle | One button, no `Select`s (decided 2026-09-07). It rolls **both** a random style out of the four curated abstract sets and a random crypto seed. Style and seed are stored so the same mark comes back; the seed is never derived from name or route, which would make shuffle a no-op and a rename change the art. |
| 7 | Generator | DiceBear, exactly as hive does it: `@dicebear/core` + `@dicebear/styles`, **local rendering only** (a Frappe site must not leak its space list to `api.dicebear.com`), **lazy `import()`** per style so the ~MB of style JSON never loads until Shuffle is pressed, one Rollup chunk per style. |
| 8 | Styles | Abstract marks only: `glass`, `blobs`, `waves`, `loops`. All CC0 and DiceBear-authored; listed one by one, never pulled wholesale from the 61-style package — licensing stays a deliberate act. No character sets: a space is a thing, not a person. `disco` was measured out (2026-09-07): ~35 kB of SVG per mark against ~4 kB for the four kept, and a mark is fetched once per row by the space list. Measure before adding a style. |
| 8b | Credit | No license line in the popover (decided 2026-09-07). Every shipped style is CC0 and DiceBear-authored, so none obliges attribution, and the credit belongs in the source comment rather than in a control the user opens to press one button. |
| 9 | Storage | New fields on `Wiki Space`: `space_icon` (Data — a full `lucide-*` class, same convention as `home_tab_icon`), `space_color` (Data — a palette name), `avatar` (Long Text, hidden in Desk — an SVG `data:` URI), `avatar_style` (Data), `avatar_seed` (Data). The upload keeps using `app_switcher_logo`. No migration. |
| 10 | Resolution | `avatar` → `space_icon` + `space_color` → `app_switcher_logo` → initial on a colour hashed from the docname. One accessor, ported to both languages. |
| 11 | Clearing | Only one direction clears destructively. Choosing an icon or shuffling writes the generated fields and **leaves `app_switcher_logo` alone**, so a picked icon never drops a File link; choosing Upload (or "Use this image" on an already-uploaded logo) clears `avatar` and `space_icon`. Remove, in the Upload tab, clears `app_switcher_logo`. |
| 12 | Public reader | **In scope** (decided 2026-09-07, reversing the original decision 8). The header, the mobile header and the switcher rows draw the same three-way mark. Cheap because `wiki.utils.lucide_svg` already inlines the curated set, and the OG card is a Jinja page screenshotted by headless Chromium — an SVG `data:` URI in an `<img src>` renders there as-is, so nothing needs rasterizing. |
| 13 | Auto-roll on create | **Yes** (decided 2026-09-01, reaffirmed 2026-09-07). Creating a space rolls a mark straight away, so no space is ever a bare initial. `NewSpaceDialog` shows it with the same picker; upload or icon replaces it. |
| 14 | Frontend/backend sync | The five new fields are enumerated wherever the frontend or a Python query lists Wiki Space fields: `useSpaceLibrary.js`, `wiki_document.py`'s switcher query, `og_image.py`'s context. House convention — nothing syncs automatically. |

## Current state

- `frontend/src/components/SpaceSettings/GeneralPanel.vue` — the row to rebuild:
  a `h-10 w-16` preview, an Upload/Replace `Button`, a Remove `Button`, a hidden
  `<input type=file>`, and `useFileUpload` posting to
  `wiki.api.upload_wiki_asset` with `private: false`.
- Three SPA render sites, all `Avatar :image="app_switcher_logo"` with an
  initial fallback — the seam `SpaceAvatar` slots into:
  `LibrarySidebar.vue:45`, `SpaceSidebar.vue:22`, `Overview.vue:83`.
- Reader sites: `templates/wiki/includes/header.html:25,53` (switcher trigger and
  the no-switcher case), `mobile_header.html:12,145`, and the switcher rows,
  which show no mark at all today.
- `wiki/api/og_image.py:142` — `logo_url = _safe_asset_url(app_switcher_logo or
  light_mode_logo)`, fed into `og_fingerprint`, which hashes exactly the inputs
  the card template consumes.
- `wiki/utils.py:17` `lucide_svg` — inline SVG for a `lucide-*` class, backed by
  the generated `wiki/lucide_icons.json` (126 entries, sourced from
  `tabIcons.js`). Already a Jinja global via `hooks.py`.
- `IconGrid.vue` / `IconPicker.vue` — the existing grid, reusable as is.
- hive's `dicebear.ts` is TypeScript; wiki's frontend is JS — port as
  `frontend/src/lib/spaceAvatar.js`, keeping the structure (style meta table
  with license credits, loader map, style cache, `renderAvatar`, `randomSeed`).

## Phases

1. **Tracer: fields, one component, the new control.** Add the five fields.
   `components/SpaceAvatar.vue` (frappe-ui `Avatar shape="square"`, image =
   sanitized data URI or logo URL, default slot = the icon, label = the
   initial), and `lib/spaceIdentity.js` for the resolution, sanitizer and
   palette. Rebuild the settings row: square trigger, popover, Upload tab
   (existing uploader, Remove, "Use this image") and Icon tab (swatches +
   `IconGrid`), no Shuffle yet. Swap `SpaceAvatar` into the three SPA sites and
   add the fields to `useSpaceLibrary`. End-to-end in the SPA.
2. **Shuffle.** Add `@dicebear/core` + `@dicebear/styles` pinned, port
   `lib/spaceAvatar.js`, wire the Shuffle button. Verify chunk-per-style in the
   `yarn build` output before anything else.
3. **Reader.** A `space_mark` Jinja macro drawing the same three-way
   resolution — tinted square via `var(--surface-{colour}-2)` /
   `var(--ink-{colour}-7)` with the colour validated against the palette
   server-side, glyph via `lucide_svg`. Use it in `header.html`,
   `mobile_header.html` and the switcher rows; extend the switcher field lists.
   Then `og_image.py`: resolve the mark into the card context, allow an
   `data:image/svg+xml` avatar past `_safe_asset_url`'s siblings check, add the
   new inputs to `og_fingerprint`, bump `TEMPLATE_VERSION`.
4. **Auto-roll on create.** `NewSpaceDialog` gets the picker with a pre-rolled
   mark; the create path stores it.
5. **Polish.** e2e.

## Regression tests

- Unit (JS): resolution priority — avatar beats icon beats logo beats initial;
  sanitizer rejects anything that is not a `data:image/svg+xml` URI; an
  off-palette colour falls back rather than emitting a class that does not exist.
- Unit (Python): the same resolution and the same sanitizer on the Jinja side,
  plus `og_fingerprint` changing when the icon, the colour or the avatar changes.
- e2e: pick an icon → save → reload shows it; shuffle → save → reload shows the
  same art; the upload path still works and Remove still clears it.
- Run the JS unit tests with `node --test`, not vitest (see
  `specs/cleanup/001-run-frontend-unit-tests.md`).

## Landmines

- **Bundle size.** The style JSON must never reach the entry chunk. A bare
  `import` (not `import()`) anywhere in `lib/spaceAvatar.js` defeats the whole
  design; check `yarn build` output.
- **List payloads.** `avatar` is a ~4 kB data URI and the sidebar fetches it per
  row. That is why the style list is measured rather than picked by eye. The
  alternative — re-rendering from style + seed in the sidebar — would pull the
  style chunks into the sidebar's load path, which is worse. Do not add
  `avatar` to any pagination-heavy query without need.
- **Desk usability.** `avatar` is a Long Text holding a data URI; mark it hidden
  or read-only or the Wiki Space form becomes a wall of text.
- **Tailwind literals.** Any `lucide-*` class that is not literally present in
  scanned source renders blank. Staying inside `TAB_ICONS` is what avoids this
  on both the SPA and reader sides.
- **Cache.** Space edits are cached on the reader; clear space caches on update
  the way the existing logo fields do. Version-3 CR whitelists do not apply —
  `Wiki Space` is not a `Wiki Document`.
- **SVG is a script host.** A stored avatar is a field a Wiki Manager can write.
  It only ever becomes an `<img>` source, never markup, and only after it proves
  to be an SVG data URI — on both the JS and the Python side.

## Progress log

- 2026-09-01 — Spec written from `wiki-proto` + hive reference read.
- 2026-09-01 — Decisions locked: tabs removed, /spaces retired, duckdb+pandas approved, avatar auto-roll on create.
- 2026-09-07 — Rewritten against the settings-panel screenshot. Generate tab becomes an Icon tab (swatches + grid + one Shuffle); style and variant `Select`s dropped; public reader and OG card pulled into scope; icon set fixed to `TAB_ICONS`; clearing made one-directional.
- 2026-09-07 — Phases 1 and 2 built: the fields, `SpaceAvatar`, `SpaceIdentityPicker`, and the generator behind Shuffle. `disco` dropped on measurement; the credit line dropped on review.
