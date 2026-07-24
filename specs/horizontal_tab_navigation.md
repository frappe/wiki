# Horizontal Tab Navigation for Frappe Wiki

Date: 2026-07-25
Status: **Planned.** Not yet started.

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
