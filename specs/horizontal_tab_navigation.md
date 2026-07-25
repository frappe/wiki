# Horizontal Tab Navigation for Frappe Wiki

Date: 2026-07-25
Status: **In progress.** See [Progress log](#progress-log) at the bottom.

## Problem

Large docs sites (ERPNext ≈ 1200 pages) can't be navigated by a single vertical
tree. A flat left sidebar with a dozen deep modules is unusable — breadth is
hidden, and switching between modules (Accounting → Selling → Manufacturing)
means scroll-hunting the tree. Modern docs (Stripe, Ecwid, Gravitee) put the
top-level areas on a **horizontal tab bar**: breadth is always visible up top,
one click switches the whole tree underneath.

## Goal

Let an editor flag a **top-level group** in a Wiki Space as a **tab**. Tab groups
render in a horizontal bar above the sidebar; clicking one swaps the vertical
tree to that tab's subtree. Non-tab top-level content keeps working exactly as
today (coexist, not all-or-nothing).

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | What is a tab? | A **top-level group** (direct child of the Space's `root_group`), flagged `is_tab`. Must be a group; must be top-level — enforced at validate. |
| 2 | URL model | Tab is an explicit path **segment** — but the tab group's slug is **already** an ancestor slug in today's route (`<space>/<tab-slug>/<...>`). So existing routes are unchanged. Active tab = walk the current page's ancestors up to the tab-flagged group. |
| 3 | Mobile / narrow | **Dropdown collapse.** Below a breakpoint the active tab becomes a dropdown trigger listing all tabs. |
| 4 | Icon | **Tabs only.** New `tab_icon` (Lucide class name, e.g. `lucide-wallet`) on Wiki Document, picker shown only when `is_tab` is set. Rendered in the tab bar. Picker is gameplan's `IconPicker.vue` **copied as-is, styles included** — see Phase 4. |
| 5 | Migration of existing pages | **Manual.** Editor flags each module root as a tab in the UI. No migration script — out of scope. |
| 6 | Tab landing | The tab **group's own content page** (a group can still hold `content`). Falls back to the first published leaf in its subtree if empty. |
| 7 | Mixed mode | **Coexist.** Tab groups go to the top bar; non-tab top-level groups/pages stay in the vertical sidebar as today. |
| 8 | Creating a tab | **Direct "New Tab" action** in the tree panel — one dialog (title + icon) creates a top-level group with `is_tab=1`. Backend does the same thing as create-group-then-flag; the flag path stays available for promoting an existing group. |
| 9 | Contribution flow | Tabs must survive the draft → change-request → merge round trip. `is_tab`/`tab_icon` are node fields like any other and go through the same CR machinery. **This is the bulk of the backend work** — see Landmines. |
| 10 | Who can create a tab | **Editor-level (`can_write_space`)**, not open contributors. A tab restructures top-level nav for the whole space; today there is no separate "restructure" gate (`permissions.py` `can_contribute_to_space` lets any contributor create groups), so this is a **new** gate. Revisit if it proves too strict. |

## Current State (what exists)

- **`Wiki Document`** (`wiki/frappe_wiki/doctype/wiki_document/`) — the V3 NestedSet node,
  both groups and leaves. `is_group` distinguishes them. Tree = `parent_wiki_document`
  + `lft`/`rgt`, ordering = `sort_order`. A group can carry `content`.
- **`Wiki Space.root_group`** → the tree root. Space `route` is the URL prefix.
  Space already has an unrelated horizontal **switcher** (`show_in_switcher`,
  `switcher_order`) — that switches whole *Spaces*, not tabs; we are **not** reusing it.
- Route built in `wiki_document.py` `set_route` = `<space route>/<ancestor slugs>/<slug>`
  (root_group excluded). This is why decision #2 needs no route migration.
- Tree APIs: `wiki/api/wiki_space.py` `get_wiki_tree` (editable) + `_build_wiki_tree_for_api`;
  `wiki_document.py` `build_nested_wiki_tree` / `get_public_wiki_tree` (Redis-cached,
  key `wiki_public_tree`), `get_first_published_page`.
- Frontend tree: `frontend/src/components/WikiTree.vue` (recursive `<Tree>`, node icons
  hardcoded by type ~L34-36), fed by `WikiDocumentList.vue`, hosted in
  `SpaceTreePanel.vue` / `pages/SpaceDetails.vue`. Editable tree state in
  `stores/draftWorkspace/treeModel.js` (normalize/denormalize, `doc_key`-keyed).
- **No** icon field and **no** icon picker exist today (icons for external links are
  computed from URL host in `wiki_document.py` `KNOWN_SERVICE_ICONS`).

### Contribution / change-request flow (matters more than expected)

- Editors never write `Wiki Document` directly. They mutate a **change request**:
  `Wiki Change Request` holds `base_revision` + `head_revision` (an *overlay* revision).
  The unit of storage is a **`Wiki Revision Item` row per node** — not a JSON diff.
  So `Wiki Revision Item` mirrors the `Wiki Document` field set and **also** needs
  `is_tab` / `tab_icon`.
- Batch entrypoint `apply_cr_operations` (`wiki_change_request.py:960`) dispatches
  `create_node | update_node | update_content | delete_node | move_node | reorder_children`.
- Merge writes back to real docs in `_apply_merge_changes_only`
  (`wiki_change_request.py:1860-1993`, field block `:1957-1975`).
- Groups are **fully supported** in the contribution flow already ("New Group" at
  `WikiDocumentList.vue:300` and `WikiTree.vue:327`) — so "New Tab" rides the same
  `createNode` path.
- **No separate permission gate for restructuring** vs editing content: both go through
  `can_contribute_to_space` (`permissions.py:130`). Decision #10 adds one.

---

## Landmines (found during recon — read before writing code)

Adding a field to a node is **~40 explicit whitelists**, not 3. Every list below is a
hard-coded field enumeration; an omission fails *silently*, not loudly. The four that
cause silent data corruption:

1. **`ensure_overlay_item` (`wiki_revision.py:374-388`)** — copy-on-write clone of a base
   item. Omit the field and it **silently resets to default the first time anyone edits
   that node in a change request.** A tab would spontaneously stop being a tab.
2. **`tree_hash` component tuple (`wiki_revision.py:248-263`)** — omit and a tab-only
   change is hash-identical to no change, so `has_revision_changes` / outdated detection
   never fires.
3. **`_find_changed_keys.compare_fields` (`wiki_change_request.py:1707-1720`)** — omit and
   **merge skips the document entirely**; the change is silently lost on merge.
4. **`_classify_changes.metadata_fields` (`wiki_change_request.py:1827-1838`)** — omit and
   the change is misclassified as content-only, taking the fast `db.set_value` path and
   skipping the structural write.

Frontend equivalents: `normalizeNode` (`treeModel.js:6-26`) and `denormalizeNode`
(`treeModel.js:30-44`) are both hard whitelists — **any unknown server field is dropped
before it ever reaches a component.** `treeAsLegacy` (`:94-106`) enforces it twice.

Adjacent pre-existing bug worth noting (do not necessarily fix here): `merge_items`
(`wiki_change_request.py:2085-2098`) already drops `is_external_link` / `external_url` on
the 3-way content-merge branch.

**Move guards barely exist today.** Client-side `allowMove` (`WikiTree.vue:285-287`) only
checks `is_group` for *inside* drops; `before`/`after` sibling drops are unconditional.
There is **no depth limit and no server-side structural validation at all** —
`_move_cr_item` (`wiki_change_request.py:414-430`) is a bare `parent_key`/`order_index`
write. So the "tab must stay top-level" rule needs guards built from scratch on **both**
sides; today nothing would stop dragging a tab into a subgroup.

---

## Tracer bullet plan

Each phase is a thin vertical slice that renders something real. Commit the spec
first, then one commit per phase. Branch: `feat/horizontal-tab-navigation`.

### Phase 0 — Data model + validation (backend)

Add to **both** `Wiki Document` **and** `Wiki Revision Item` (they mirror each other; the
CR flow stores nodes as revision items):
- `is_tab` (Check, default 0)
- `tab_icon` (Data — Lucide icon name; `depends_on: eval:doc.is_tab`)

Validation in `wiki_document.py`:
- `is_tab` requires `is_group = 1` → else `frappe.throw`.
- `is_tab` requires the node be **top-level** (`parent_wiki_document` == the Space's
  `root_group`) → else throw. This is the "one level only, no nested tabs" rule.
- Clearing `is_group` on a tab, or reparenting a tab below top-level, must clear or reject.

Bust the `wiki_public_tree` cache on change (existing cache hook path).

**Tracer:** create a group, flag `is_tab` from the console, confirm validate rejects a
nested group and a leaf.

### Phase 1 — Revision + change-request plumbing (backend)

**The riskiest phase — do it before any UI.** Thread `is_tab` / `tab_icon` through every
enumeration below. Grouped by file; the ⚠ ones are the silent-corruption sites from
Landmines.

`wiki/frappe_wiki/doctype/wiki_revision/wiki_revision.py`
- `:33-51` + `:80-93` `create_revision_from_live_tree` (read fields + assignments)
- `:145-158` + `:162-176` `clone_revision`
- `:215-232` `recompute_revision_hashes`
- ⚠ `:248-263` **`tree_hash` component tuple**
- `:282-298` `get_revision_item_map`
- ⚠ `:356-372` + `:374-388` **`ensure_overlay_item`**

`wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py`
- `:216` `_CR_ITEM_CHECKBOX_UPDATE_FIELDS` (add `is_tab`), `:215` scalar list (add `tab_icon`)
- `:246-259` + `:281-294` `_serialize_cr_item`
- `:302-337` `_create_cr_item`; `:889-905` batch `create_node` kwargs
- `:608-623` `get_cr_tree` node dict (feeds `normalizeNode`)
- `:681-694` + `:718-733` `get_cr_page`
- `:1118-1136` `diff_change_request.normalize`; `:1163-1176`, `:1178-1191`, `:1218-1233`
  change payloads; `:1192-1201` `metadata_fields`
- ⚠ `:1707-1720` **`_find_changed_keys.compare_fields`**
- ⚠ `:1827-1838` **`_classify_changes.metadata_fields`**
- `:1957-1975` `_apply_merge_changes_only` — **the primary merge write-back**
- `:2013-2026` `normalize_item`; `:2085-2098` `merge_items`; `:2109-2113` `items_equal`;
  `:2118-2119` `conflict_on_metadata`
- `:2288-2306` `create_merge_revision`; `:2369-2385` `_apply_merge_revision` (legacy)

Other: `wiki/wiki/git_sync.py:834-848`; `wiki_space.py:381-395` + `:409-419` (space
duplication); `wiki_document.py:570-580`; `wiki/api/wiki_space.py:84`.

**Server-side move guard (new):** `_move_cr_item` (`:414-430`) and the live-doc path must
reject moving a tab off top-level, and reject moving any node *into* a position that
would nest a tab. Nothing validates structure today.

**Tracer:** create a tab in a CR, edit an unrelated page in the same CR (proves
`ensure_overlay_item` doesn't wipe the flag), merge, confirm the tab exists on the live
doc and the diff showed it.

### Phase 2 — Expose in tree APIs (backend)

Thread `is_tab` + `tab_icon` through both tree builders so the frontend sees them:
- `wiki/api/wiki_space.py` `_build_wiki_tree_for_api` (editable tree)
- `wiki_document.py` `build_nested_wiki_tree` (public/cached tree)

Add a helper `get_space_tabs(space)` → ordered list of top-level tab groups
(`is_tab=1`, published), each with `title`, `route`, `tab_icon`, and its landing
target (own page route, else first published leaf — reuse `get_first_published_page`
logic scoped to the subtree).

**Tracer:** hit the API, confirm tab nodes carry the new fields and `get_space_tabs`
returns the ordered modules.

### Phase 3 — Tab bar renders (frontend, read-only)

New `frontend/src/components/WikiTabBar.vue`:
- Horizontal row of tab groups from `get_space_tabs`, each with `tab_icon` (Lucide) +
  title, routing to the tab's landing page.
- **Active tab** = walk the current page's ancestors to the tab-flagged group
  (derive from the loaded tree; no new route param needed — decision #2).
- **Dropdown collapse** below breakpoint (decision #3): active tab as a `<Dropdown>`
  trigger listing all tabs.

Wire into `SpaceTreePanel.vue` / `SpaceDetails.vue`: render the bar above the tree
**only when the Space has ≥1 tab**. Vertical sidebar shows the **active tab's subtree**;
non-tab top-level nodes still render in the sidebar (decision #7 coexist).

**Frontend whitelists that must carry the fields** (unknown fields are silently dropped —
see Landmines): `treeModel.js:6-26` `normalizeNode`, `treeModel.js:30-44`
`denormalizeNode`, and `SpaceDetails.vue:327-338` `adaptReadonlyNode` (git-synced tree
adapter). Update the node-icon block in `WikiTree.vue:20-36` if tab groups need a
distinct glyph in the tree.

**Tracer:** a Space with 2 tabs shows the bar; clicking swaps the subtree; deep-linking
to a page under a tab highlights the right tab.

### Phase 4 — Creating and editing tabs (frontend)

**"New Tab" action** (decision #8) — in `WikiDocumentList.vue` alongside the existing
root-level "New Group" (`:300-305`). One dialog: title + icon. Routes through
`useTreeDialogs.openCreateDialog` → `draftStore.createNode`, so `isTab` must be threaded
through the four create-path whitelists: `createNode` signature (`draftWorkspace.js:455-463`),
local node literal (`:466-480`), queue payload (`:497-505`), wire op (`:538-549`).
Shown only to editors (decision #10).

**Promote/demote an existing group** — "Make this a tab" toggle in group settings, offered
only for top-level groups (mirror the backend rule so the UI never offers an invalid
action). Note `updateNode`'s local-apply block (`draftWorkspace.js:622-629`) has no branch
for new fields — a change would round-trip to the server but not update the local node
until `reloadTree()`. Add the branch.

**Client move guard** — extend `allowMove` (`WikiTree.vue:285-287`) to reject dropping a
tab anywhere but top-level. Today it only checks `is_group` for inside-drops, and
sibling drops are unconditional. Backend guard from Phase 1 is the real enforcement;
this is UX.

**Icon picker — copy gameplan's `IconPicker.vue` verbatim, styles included.**
Source: `frappe/gameplan` → `frontend/src/components/IconPicker.vue` (gameplan is not in
this bench; clone the repo to read it). Also copy `SpaceIcon.vue` — the 12-line render
component that falls back to `lucide-hash` for a missing/invalid icon.

What it is: a `reka-ui` Popover (`PopoverRoot/Anchor/Portal/Content`) over a
`grid-cols-8` of 8×8 buttons, each rendering `<span :class="[icon.class, 'size-5']" />`.
Selection emits `update:modelValue` and closes. Verified compatible as-is:
- wiki has `reka-ui` 2.10.1 (gameplan is on ^2.0.2) and all four Popover primitives are
  exported — no adaptation needed
- both apps use `frappeUIPreset` in `tailwind.config.js`, which is what provides the
  `lucide-*` classes; wiki's `WikiTree.vue` already uses them
- the surface/ink token classes (`bg-surface-elevation-2`, `text-ink-gray-7`, …) come from
  the same preset

**The icon list is a curated 104 entries, not a search over all ~1994 lucide icons — and
that is load-bearing, not taste.** Tailwind JIT only emits a class it can find as a
literal in scanned source. `tab_icon` arrives from the DB at runtime, so those classes are
only generated because the 104 literals sit in `IconPicker.vue`, which `./src/**/*.vue`
scans. A free-text search over `lucide-static` would render **blank icons** for anything
not otherwise mentioned in source. Copy the list as-is; adding an icon later means adding
it to this list.

Two dead bits in the original, carried over or cleaned as preferred: `filteredIcons` is a
straight passthrough (`const filteredIcons = icons`) and each entry's `keywords` array is
unused — a search box was planned and never wired.

Per CLAUDE.md "Frontend / Backend Sync": both fields must be enumerated explicitly in the
frontend settings component — no auto-sync.

**Tracer:** create a tab from the UI with an icon, see it in the bar without a desk
round-trip; try to drag it into a subgroup and get blocked.

### Phase 5 — Public reader parity

Mirror the tab bar in the public (Jinja/SPA) reader. Note the DOM-twin gotcha:
prev/next + TOC markup is duplicated in Jinja **and** the `sidebar.html` nav-store JS —
the tab bar likely needs the same dual treatment so SPA nav doesn't show a stale bar.

**Tracer:** public URL of an ERPNext-style space shows tabs, switches trees, active tab
correct on hard load and on SPA nav.

## Tests

- **Unit (backend, validation):** validate rejects (a) `is_tab` on a leaf, (b) `is_tab` on
  a non-top-level group, (c) moving a tab off top-level. `get_space_tabs` ordering +
  landing-page fallback (own page → first published leaf). Per CLAUDE.md, temp-revert each
  guard to confirm the test fails without the fix.
- **Unit (backend, CR round trip) — the ones that matter most.** Each targets a
  Landmine and would silently pass today:
  - Create a tab in a CR, then edit an *unrelated field on that same node*; assert
    `is_tab` survives (guards `ensure_overlay_item`).
  - Flip `is_tab` as the *only* change; assert `has_revision_changes` is true (guards
    `tree_hash`).
  - Flip `is_tab` as the only change and **merge**; assert the live `Wiki Document` has it
    (guards `_find_changed_keys` and `_classify_changes` — both would drop it).
  - Assert `diff_change_request` reports the tab change.
- **E2E (Playwright):** create a tab via "New Tab" with an icon, switch between two tabs,
  deep-link into a tab's subtree and assert active-tab highlight, mobile dropdown collapse,
  and the full contribute → review → merge flow with a tab change in it.
  `BASE_URL=http://wiki.localhost:8000`.

## Out of scope

- Automated migration of existing ERPNext content into tabs (manual per decision #5).
- Per-tab roles/permissions (inherit Space roles).
- Nested tabs (explicitly forbidden by decision #1).
- Reusing / merging with the Space `show_in_switcher` mechanism.
- Fixing the pre-existing `merge_items` field drop (`wiki_change_request.py:2085-2098`) —
  noted in Landmines, worth its own bug fix.
- A general depth limit on the tree (none exists today; the tab rule is a targeted guard,
  not a fix for the missing structural validation in general).

---

## Progress log

### Phase 0 — Data model + validation ✅

- `is_tab` (Check, `depends_on: is_group`) + `tab_icon` (Data, `depends_on: eval:doc.is_tab`)
  added to **`Wiki Document`** and **`Wiki Revision Item`** JSONs.
- New module helper `is_top_level_group(parent_name)` in `wiki_document.py` — true when the
  parent is some Wiki Space's `root_group`. This is the single definition of "top-level"
  and is reused by the Phase 1 move guards.
- `WikiDocument.validate_tab()` wired into `validate()`: throws on a leaf tab, throws on a
  non-top-level tab. Clearing `is_group` on a tab therefore *rejects* (rather than silently
  clearing) — the same check fires.
- Cache busting needed no new code: `on_wiki_document_update` already calls
  `clear_wiki_tree_cache()` unconditionally.

**Deviation from spec:** `tab_icon` is deliberately *not* cleared when `is_tab` is unset, so
a demote→promote round trip keeps the icon. It is only ever read when `is_tab` is set.

Tracer verified on `wiki.localhost`: top-level group tab inserts with icon; leaf tab, nested
tab, and reparenting a tab under a subgroup are all rejected.

### Phase 1 — Revision + change-request plumbing ✅

Threaded through every enumeration the spec listed (9 sites in `wiki_revision.py`, ~20 in
`wiki_change_request.py`), plus `git_sync.py` and space duplication.

All four silent-corruption sites have a test that was **verified to fail with the fix
temp-reverted** (per CLAUDE.md), so none of them pass vacuously:

| Landmine | Test | Symptom when reverted |
|---|---|---|
| `ensure_overlay_item` | `test_tab_survives_unrelated_edit_on_same_node` | `0 != 1: is_tab was reset by the overlay copy-on-write` |
| `tree_hash` tuple | `test_is_tab_only_flip_registers_as_a_change` | `False is not true: an is_tab-only change was invisible to the tree hash` |
| `_find_changed_keys` | `test_is_tab_only_flip_reaches_the_live_document_on_merge` | `There are no changes to submit for review` |
| `_classify_changes` | (same test) | `0 != 1: merge dropped is_tab` |

**Guards added (none existed before):**
- `_create_cr_item`, `_update_cr_item`, `_move_cr_item` — a tab must stay a top-level group.
  `_update_cr_item` re-checks the *post-update* item, so flipping `is_tab` and `is_group` in
  one call can't slip through.
- `reorder_wiki_documents` (`api/wiki_space.py`) — this writes `parent_wiki_document` with a
  raw `db.set_value` and so bypasses document validation entirely. Without its own copy of
  the guard, dragging a tab into a subgroup would have silently produced a nested tab.

**Permission (decision #10):** new `can_manage_tabs` / `assert_can_manage_tabs` wrapping
`can_write_space`. Enforced at the two CR mutation chokepoints rather than per-endpoint, so
the legacy RPCs and `apply_cr_operations` can't drift. Editing a tab group's *content* stays
open to ordinary contributors — only `is_tab` / `tab_icon` changes are gated.

**Beyond spec:** `git_sync.py` carries the tab flags forward from the previous snapshot. A
repo can't express them, so re-deriving would have silently demoted a space's tabs on every
sync.

### Phase 2 — Tree APIs + `get_space_tabs` ✅

Both tree builders carry the fields. `get_space_tabs(space)` returns ordered tabs with a
`landing_route`.

**Deviation from decision #6:** a group is never served at its own route — the renderer
redirects it to its first child. So "the tab group's own content page" only exists as a
published *leaf* sitting at the group's route (the README/index case git-sync produces).
`_tab_landing_route` prefers that when present, else the first published leaf in the subtree.

### Phase 3 — Tab bar renders ✅

`WikiTabBar.vue`, fed from **the tree the sidebar is already rendering** rather than
`get_space_tabs` — in the editor that's the draft/CR tree, so a tab created in an unmerged
draft appears immediately. (`get_space_tabs` is for the reader, which wants live data.)

Three tiers driven by a `ResizeObserver` on the bar's own width (the sidebar is
user-resizable, so a viewport media query would be wrong): icon + label → icon-only with the
active tab keeping a truncating label → dropdown. At the default 280px sidebar the middle
tier is what fits, which reads as a segmented control. Widths are *estimated*, not measured:
the row's real width is a function of the tier, so measuring oscillates.

**Deviation from decision #7:** the active tab becomes the sidebar's root, so top-level drops
reparent into the tab rather than the space root. Non-tab top-level content stays reachable
under its own **General** bar entry instead of rendering inline. Keeping it inline (the
literal reading) while root-level drops still resolved to the space root would have silently
moved pages out of their tab on drag.

**Bug found and fixed here:** deriving the active tab from a computed that preferred the open
page made the tab buttons inert — the open page always won, so clicking never changed the
view. It's now a single `ref` so the most recent action wins.

**Tailwind safelist confirmed empirically:** seeding `lucide-shopping-cart` (absent from the
curated list) rendered a blank icon. The list moved to `lib/tabIcons.js` so the popover picker
and the inline grid share one safelist.

### Phase 4 — Creating and editing tabs ✅

"New Tab" (title + icon) in the sidebar add menu; "Make this a tab" row action on top-level
groups; client-side `allowMove` guard; editor-only via `get_space_capabilities.can_write`.

- **Five** create-path whitelists, not the four the spec listed — the non-batch fallback calls
  `changeRequest.createPage` **positionally**, so it would have dropped both fields whenever
  batch operations are off.
- `IconPicker` copied from gameplan (99 icons) but converted TS→JS to match the codebase, and
  given an `inline` mode: nested inside a `Dialog`, the reka-ui popover's interactions are
  swallowed by the dialog's focus trap.
- **Bug found and fixed here:** gating "New Tab" on "the sidebar root is the space root" was a
  catch-22 — once a space has tabs, a tab is always the active root, so the action never
  appeared. It now always parents to the space root explicitly.

### Phase 5 — Public reader parity ✅

Tab bar in `sidebar.html`, with per-tab subtrees in the nav.

**The DOM-twin problem the spec warned about does not arise.** The reader's tree already
drives its active-page highlight off `$store.navigation.currentRoute` rather than re-rendering,
so the tab bar and subtree visibility use the same mechanism: a new `inTab(route)` helper on
the navigation store. Because a tab's slug is always an ancestor segment of its pages' routes
(decision #2), "is this page in this tab" is a pure route-prefix test. Nothing is re-rendered
on SPA nav, so nothing can go stale.

**Known gap:** the reader's tab bar is **labels-only**. The reader's Tailwind build (a plain
`@tailwindcss/cli` pass over `wiki/public/css/main.css`) has no lucide icon plugin — the editor
gets one via `frappeUIPreset` — so a `lucide-*` class there renders as an empty box. Adding an
icon pack to the reader bundle is its own change.

### Tests

- **Backend:** 16 new tests — `TestWikiChangeRequestTabs` (10), `TestTabValidation` (6),
  `TestGetSpaceTabs` (7). Full suite green: change request 98, document 41, permissions 37,
  git-sync 66, space 5, api — all OK.
- **E2E:** `e2e/tests/tab-navigation.spec.ts`, 5 tests, self-contained (builds its own space
  through the API and tears it down, so it doesn't depend on seeded data). Covers reader bar +
  SPA nav + deep link, editor bar + subtree swap, and creating a tab with an icon.

### Not done

- Mobile dropdown collapse is implemented and exercised by the resize logic, but has no
  dedicated e2e test.
- The full contribute → review → merge flow with a tab change is covered by a **backend**
  round-trip test, not by Playwright.
- Icons in the public reader — done in Phase 6.

### Phase 6 — Layout rework + reader icons ✅

Feedback after Phase 5 was that the bar read as a *sibling* of the sidebar tree rather than
its parent. Reworked so the chrome stacks top-down at full width:

```
navbar (full width)
tabs   (full width)
sidebar | content
```

**Reader.** `layout.html` now includes `header.html` and the new `tabs.html` above the
sidebar/content flex row instead of inside the content column. The sidebar's own 53px logo
header moved into the navbar — with a full-width navbar there is no top-of-window strip left
for it. Everything that sticks below the chrome (sidebar, sidebar toggle, TOC) offsets against
a single `--wiki-chrome-h` variable defined in `main.css`: 0 below `lg` (desktop chrome is
hidden there), 53px without tabs, 97px with. A CSS variable rather than an inline value
precisely because the offset has to collapse at the mobile breakpoint.

**Editor.** The bar stays inside the content column (the SPA has a left app rail, not a top
navbar), but now renders *below* `ContributionBanner`: the banner is about the whole draft, so
it outranks whichever tab is being browsed.

**Add button.** `WikiTabBar` grew a `+` that is always last and never collapses into the
overflow menu — creating a tab is an action on the bar, not one of its entries. It opens a
create dialog owned by `SpaceDetails` rather than reusing the tree's, because a tab always
parents to the space root regardless of which subtree the sidebar shows. The tree's own
"New Tab" menu entry stays as a second path.

**Drag-reorder.** Native HTML5 drag on the triggers (the tree's frappe-ui `Tree` DnD isn't
available here). The General entry is synthetic, so it is never draggable and always trails
the real tabs. `reorderTab` in `SpaceDetails` translates the bar's slot index back into the
shared top-level sibling list — tabs and untabbed content live in one list, and `moveNode`
splices *after* pulling the dragged node out, so both shifts have to be accounted for.

**Reader icons — the Phase 5 gap is closed.** Not by adding an icon pack to the reader bundle:
emitting the curated 100 icons as masked-background CSS came to ~200KB on every page. Instead
`scripts/generate-public-lucide.mjs` (wired into `yarn theme:generate`) writes
`wiki/lucide_icons.json` from the same `TAB_ICONS` list, and the new `wiki.utils.lucide_svg`
jinja method inlines the SVG for the handful of tabs a page actually renders. Unknown icons
fall back to `lucide-hash`, mirroring `SpaceIcon.vue`.

**Tests.** Three new e2e tests in `tab-navigation.spec.ts` (8 total): reader row stacking +
navbar space name + inline icon, editor add-button create + banner-above-tabs ordering, and
editor drag-reorder. Regression sweep over `public-pages`, `toc-navigation`, `sidebar`,
`sidebar-reveal`, `search-modal`, `ordering`, `space-default-page`, `tree-search`,
`mobile-view`, `wiki` found no new failures — the remaining ones fail identically on a
stashed baseline (local job-queue/test-data flakiness, not this change).

### Phase 7 — Home tab, editor layout parity, better drag ✅

Feedback after Phase 6: the synthetic entry read as "General" and trailed the real tabs, so a
newly-created tab appeared to its *left*; the native-DnD reorder was flaky; the `+` was a bare
icon; and the editor bar still lived inside the content column, unlike the reader.

**Home, not General — and it leads.** `buildTabList` renames the synthetic entry to "Home"
(icon `lucide-house`) and `unshift`s it to the front, so content tabs follow it and new tabs
(backend `sort_order = max + 1`) land rightmost. In the *editor* Home is now shown
unconditionally — even with no tabs yet — so the tab model and the "＋ New Tab" affordance are
always discoverable. `GENERAL_KEY`/`__general__` stays as the internal key.

**Reader Home (`get_space_tabs`).** The reader gains a Home entry only when the space has ≥2
tabs *and* untabbed top-level content to land on — with one tab it's noise, with none there's
nowhere to point. `_home_tab_entry` routes it to the first published leaf of the untabbed
subtree. `tabs.html` highlights it via a new `notInAnyTab(routes)` nav-store method (active
when the page is under none of the real tabs) rather than a prefix of its own route.
`sidebar.html` now gates the untabbed subtree behind that same predicate when Home is present,
so it shows only while Home is active — instead of trailing every tab as before. `lucide-house`
was added to `TAB_ICONS` so `generate-public-lucide.mjs` inlines it for the reader.

**Drag via SortableJS.** Native HTML5 DnD replaced with `@vueuse/integrations` `useSortable`
(pointer-`forceFallback`, `animation`, ghost). `watchElement: true` is load-bearing: the bar
mounts before tabs load async, so without it the sortable target doesn't exist at mount and
Sortable never initialises. Only the real tabs are draggable — Home is a pinned, separate
button outside the sortable container. On drop the bar emits `{ docKey, toIndex }` (index among
real tabs) and the parent persists + re-derives, resyncing the mirror list.

**Editor layout.** `SpaceDetails.vue` root is now `flex-col`: the draft/git banner and the tab
bar stack full-width above a `[sidebar | content]` row, mirroring the reader's
`navbar > tabs > tree`. The bar therefore left `<main>`, so the editor e2e tests source it at
page level.

**＋ New Tab.** The bare `+` became a frappe-ui ghost `Button` labelled "New Tab".

**Tests.** `tab-navigation.spec.ts` at 9 tests (added a reader-Home test; updated the
untabbed-content assertion — it's now gated behind Home — the reorder order-helper to skip
Home, and the drag to drive real mouse-move steps since `forceFallback` ignores HTML5 `dragTo`).
Three new `TestGetSpaceTabs` cases cover Home present / single-tab / fully-tabbed. Full
`tab-navigation` suite and `TestGetSpaceTabs` green.

---

## Follow-up: inline tab editing, Home customization, layout finalization

**Reader Home now appears with ≥1 tab** (was ≥2). `get_space_tabs` drops the `len >= 2`
guard — a single-tab space with untabbed content shows Home; a fully-tabbed space still omits
it (`_home_tab_entry` returns None with nowhere to land).

**Home is customizable.** New Wiki Space fields `home_tab_title` (default "Home") and
`home_tab_icon` (default `lucide-house`). `_home_tab_entry` reads them for the reader;
`buildTabList`/`useSpaceTabs` take a `homeMeta` getter sourced from `space.doc` for the editor.
The Home tab is synthetic (no node), so edits write the Wiki Space doc directly via
`space.setValue`; real tabs still go through `draftStore.updateNode`.

**Inline icon + rename (`WikiTab.vue`).** Each tab is now a `WikiTab` — clicking its icon opens
the existing popover `IconPicker` inline (Gameplan-style) and updates immediately;
double-clicking the label renames it. Works for Home and real tabs. `WikiTabBar` emits
`update-icon` / `rename-tab` with the tab key; `SpaceDetails` routes them.

**Convert to tab.** The tree context menu splits: a non-tab group emits `convert-to-tab`
(simple confirm dialog, default icon `lucide-book-open-text` / "Knowledge", editable inline
after) instead of the checkbox+icon dialog. New Tab creation likewise drops the icon prompt,
applies the default, and auto-selects the created tab.

**Editor header finalized to inline.** The prototype header/banner variant toggles were
removed. Editable pages fold the route under the title with badges beside it and park the page
actions (View Page / Save / More) in the tab-bar row via a `Teleport` to `#wiki-page-actions`;
read-only pages keep the dedicated header row. The CR banner is the slim `minimal` layout
(space identity + status badge, `px-2` gutters aligned with the tab row). Leaf tree rows drop
the chevron-placeholder so file icons sit at the left edge.

**Tests.** Added `test_home_tab_uses_the_space_title_and_icon`; flipped the single-tab Home
case. `TestGetSpaceTabs` green (65 in module).
