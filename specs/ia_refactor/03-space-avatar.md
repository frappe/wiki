# Space Avatar: Upload or Generative Art

Date: 2026-09-01
Status: **Planned.** Renders in spec 01's sidebar; picker lives in spec 02's
settings dialog (can ship against the old dialog if it lands first).
Reference implementation: `apps/bwh_hive` — `frontend/src/lib/dicebear.ts`,
`components/common/IdentityAvatar.vue`, `components/common/IdentityPicker.vue`.

## Problem

A space's identity today is `app_switcher_logo` (an upload) or a bare initial.
The new sidebar and overview lean on per-space identity tiles; most spaces
will never get a hand-made logo, and rows of gray initials say nothing.

## Goal

Two ways to give a space a face, picked in one control: **upload an image** or
**generate abstract art** (hive-style: DiceBear rendered locally, shuffle
button, a few curated abstract styles). Everything that shows a space — the
library sidebar, space sidebar header, overview rows, space switcher — renders
the same mark through one component.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Generator | DiceBear, exactly as hive does it: `@dicebear/core` + `@dicebear/styles`, **local rendering only** (no api.dicebear.com — a Frappe site must not leak its space list), **lazy `import()`** per style so the ~MB of style JSON never loads until the picker opens, one Rollup chunk per style. |
| 2 | Styles | Abstract marks only: `glass`, `blobs`, `waves`, `disco`, `loops`. All CC0/DiceBear-authored; styles are listed one by one, never pulled wholesale (licensing stays a deliberate act — hive's rule). No character/face sets: a space is a thing, not a person. |
| 3 | Storage | New fields on `Wiki Space`: `avatar` (Long Text — SVG `data:` URI), `avatar_style` (Data), `avatar_seed` (Data). Uploaded image keeps using `app_switcher_logo` (Attach Image). `avatar` set ⇒ generative wins; else `app_switcher_logo`; else initial fallback. No migration needed. |
| 4 | Seed | Random per shuffle (crypto), stored — not derived from name/route (derivation makes shuffle a no-op and renames would change the art). |
| 5 | Picker | One popover/dialog with `TabButtons`: **Upload** (existing FileUploader flow → `app_switcher_logo`, Remove button) \| **Generate** (style Select, live preview, Shuffle button, per-style variant Selects for the 1–2 "aspects" DiceBear exposes). Choosing one mode clears the other on save. Entry points: Space settings → General ("Space logo" row) and the New Space dialog. |
| 6 | Render component | `components/SpaceAvatar.vue` modeled on hive's `IdentityAvatar`: frappe-ui `Avatar` (square), `image` = avatar data URI or logo URL, default slot = initial fallback, so a bad data URI can never leave an empty tile. Data URI goes through a sanitizing accessor (`spaceAvatarSrc`) — it is stored user content, never injected as markup. |
| 7 | Frontend/backend sync | The three new fields are enumerated wherever the frontend lists Wiki Space fields (settings panel form, `useList` field lists in the sidebar/overview). House convention — no auto sync. |
| 8 | Public reader | Out of scope. The reader keeps using the logo fields it already reads; generative avatars appear there only if/when the reader is touched separately. |
| 9 | Auto-roll on create | **Yes** (decided 2026-09-01, hive's rule): creating a space rolls a random generative avatar (default style, random seed) straight away, so no space is ever a bare initial. The New Space dialog shows it with a Shuffle next to it; upload replaces it. |

## Current state

- `Wiki Space` fields today: `light_mode_logo`, `dark_mode_logo`,
  `app_switcher_logo`, `favicon` — all uploads, no icon/colour/avatar.
- `components/SpaceIcon.vue` renders stored lucide classes (used for tabs) —
  unrelated to space identity, stays as is.
- `SpaceList.vue` (or its spec-01 successor `LibrarySidebar`) renders
  `Avatar :image="app_switcher_logo"` with initial fallback — exactly the seam
  `SpaceAvatar` slots into.
- hive's `dicebear.ts` is ~self-contained and TypeScript; wiki's frontend is
  JS — port as `frontend/src/lib/spaceAvatar.js` keeping the structure
  (style meta table incl. license credits, style loader map, style cache,
  `renderAvatar`, `randomSeed`, variant listing).

## Phases

1. **Backend fields + render path tracer.** Add the three fields; `SpaceAvatar.vue`
   with priority avatar → logo → initial; swap it into the sidebar (or
   SpaceList if spec 01 hasn't landed). Hand-set an avatar via Desk to verify
   end-to-end.
2. **Generator lib.** Port `dicebear.ts` (add `@dicebear/core` +
   `@dicebear/styles` deps, pinned; verify chunk-per-style in the build
   output).
3. **Picker.** Upload | Generate tabs, shuffle, style + variant controls,
   save/clear semantics; wire into Space settings General and New Space
   dialog, with auto-roll on create (decision 9).
4. **Polish.** Loading state while a style chunk downloads, license credit
   line in the picker, e2e.

## Regression tests

- Unit: priority resolution (avatar beats logo beats initial), seed survives
  save/reload (same SVG re-rendered from style+seed equals stored URI — or at
  minimum stored URI is reused untouched).
- Unit: sanitizer rejects a non-`data:image/svg+xml` avatar value.
- e2e: generate → shuffle → save → reload shows the same art; upload path
  unchanged.

## Landmines

- **Bundle size**: the styles JSON must never land in the entry chunk. Check
  `yarn build` output; a bare `import` (not `import()`) anywhere in the lib
  defeats the whole design.
- `avatar` is a Long Text holding a data URI — Desk shows it as a wall of
  text; set `hidden` or `read_only` in the doctype to keep Desk usable.
- List APIs that fetch spaces now carry a potentially multi-KB `avatar` field
  per row — acceptable for the sidebar (one fetch), but don't add it to
  hot/pagination-heavy queries without need.
- Version-3 CR whitelists don't apply (`Wiki Space` isn't `Wiki Document`),
  but space edits may still be cached — clear space caches on update as the
  existing logo fields do.

## Open questions

- Fixed brand-ish color per space (hive also derives a color theme from the
  docname) — worth porting `projectColorTheme` for the initial fallback?
  Cheap, probably yes. (Less pressing now that auto-roll means initials only
  appear on pre-existing spaces.)

## Progress log

- 2026-09-01 — Spec written from `wiki-proto` + hive reference read.
- 2026-09-01 — Decisions locked: tabs removed, /spaces retired, duckdb+pandas approved, avatar auto-roll on create.
