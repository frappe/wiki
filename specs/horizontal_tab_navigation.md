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
| 4 | Icon | **Tabs only.** New `tab_icon` (Lucide name) on Wiki Document, picker shown only when `is_tab` is set. Rendered in the tab bar. |
| 5 | Migration of existing pages | **Manual.** Editor flags each module root as a tab in the UI. No migration script — out of scope. |
| 6 | Tab landing | The tab **group's own content page** (a group can still hold `content`). Falls back to the first published leaf in its subtree if empty. |
| 7 | Mixed mode | **Coexist.** Tab groups go to the top bar; non-tab top-level groups/pages stay in the vertical sidebar as today. |

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

---

## Tracer bullet plan

Each phase is a thin vertical slice that renders something real. Commit the spec
first, then one commit per phase. Branch: `feat/horizontal-tab-navigation`.

### Phase 0 — Data model (backend)

Add to **Wiki Document**:
- `is_tab` (Check, default 0)
- `tab_icon` (Data — stores a Lucide icon name; `depends_on: eval:doc.is_tab`)

Validation in `wiki_document.py`:
- `is_tab` requires `is_group = 1` → else `frappe.throw`.
- `is_tab` requires the node be **top-level** (its `parent_wiki_document` == the Space's
  `root_group`) → else throw. This is the "one level only, no nested tabs" rule.
- Clearing `is_group` on a tab, or reparenting a tab below top-level, must clear/reject.

Bust the `wiki_public_tree` cache on change (existing cache hook path).

**Tracer:** create a group, flag `is_tab` via desk/console, confirm validate rejects a
nested group and a non-group.

### Phase 1 — Expose in tree APIs (backend)

Thread `is_tab` + `tab_icon` through both tree builders so the frontend sees them:
- `wiki/api/wiki_space.py` `_build_wiki_tree_for_api` (editable tree)
- `wiki_document.py` `build_nested_wiki_tree` (public/cached tree)

Add a helper `get_space_tabs(space)` → ordered list of top-level tab groups
(`is_tab=1`, published), each with `title`, `route`, `tab_icon`, and its landing
target (own page route, else first published leaf — reuse `get_first_published_page`
logic scoped to the subtree).

**Tracer:** hit the API, confirm tab nodes carry the new fields and `get_space_tabs`
returns the ordered modules.

### Phase 2 — Tab bar renders (frontend, read-only)

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

Normalize the new fields in `stores/draftWorkspace/treeModel.js`. Update the node-icon
block in `WikiTree.vue` if tab groups need a distinct glyph in the tree.

**Tracer:** a Space with 2 tabs shows the bar; clicking swaps the subtree; deep-linking
to a page under a tab highlights the right tab.

### Phase 3 — Editing: flag a tab + pick an icon (frontend)

In the group settings / node action UI:
- "Make this a tab" toggle (only offered for top-level groups — mirror the backend rule
  so the UI never lets you flag an ineligible node).
- Lucide **icon picker** shown when the toggle is on. Reference the latest
  `apps/gameplan` topic/channel icon picker (pull first) for the Lucide picker UX;
  build/port a `LucideIconPicker.vue`.

Per project convention (CLAUDE.md "Frontend / Backend Sync"): both new fields
(`is_tab`, `tab_icon`) must be enumerated in the frontend settings component — no
auto-sync.

**Tracer:** flag a group as a tab from the UI, pick an icon, see it appear in the bar
without a desk round-trip.

### Phase 4 — Public reader parity

Mirror the tab bar in the public (Jinja/SPA) reader. Note the DOM-twin gotcha:
prev/next + TOC markup is duplicated in Jinja **and** the `sidebar.html` nav-store JS —
the tab bar likely needs the same dual treatment so SPA nav doesn't show a stale bar.

**Tracer:** public URL of an ERPNext-style space shows tabs, switches trees, active tab
correct on hard load and on SPA nav.

## Tests

- **Unit (backend):** validate rejects (a) `is_tab` on a leaf, (b) `is_tab` on a
  non-top-level group; `get_space_tabs` ordering + landing-page fallback (own page →
  first published leaf). Per CLAUDE.md, temp-revert the validate guard to confirm the
  test fails without the fix.
- **E2E (Playwright):** flag two tabs, switch between them, deep-link into a tab's
  subtree and assert active-tab highlight, mobile dropdown collapse. `BASE_URL=http://wiki.localhost:8000`.

## Out of scope

- Automated migration of existing ERPNext content into tabs (manual per decision #5).
- Per-tab roles/permissions (inherit Space roles).
- Nested tabs (explicitly forbidden by decision #1).
- Reusing / merging with the Space `show_in_switcher` mechanism.
