# Role-Based Access Control for Wiki Spaces

Date: 2026-06-16
Status: **Implemented & verified** on wiki.localhost (2026-06-16). See [Verification](#verification). The phase notes below have been reconciled to reflect the final implementation; deviations from the original plan are called out inline and summarized in [Implementation Notes (as-built)](#implementation-notes-as-built).

## Goal

Let admins configure, **per Wiki Space, which roles get Read vs Write access**, enforced everywhere (Vue SPA, Desk, public `/wiki/...` portal) by leaning on Frappe's permission framework so we write as little code as possible.

Settled semantics:

- **Read** role → view the space + its pages **and raise Change Requests** (propose edits).
- **Write** role → additionally **merge Change Requests** (apply to the live wiki). Write implies Read.
- **No roles configured** → open to all logged-in users (backward compatible). `System Manager` / `Wiki Manager` always have full access.
- Uses **existing Frappe Roles** (Link to `Role`), not new custom roles.
- **Guest/public access is a role, not a checkbox.** The per-page `is_private` flag (and deprecated `Wiki Page.allow_guest`) are **removed**; a space whose Read list contains the framework's built-in **`Guest`** role is publicly/anonymously readable (`frappe.get_roles()` returns `Guest` for anonymous requests, so it flows through the same code path). `All` = every logged-in user.

## Current State (verified)

- No per-space access control exists. Every logged-in user has `Wiki User` (auto-granted in `hooks.py` → `add_wiki_user_role`), giving the baseline read floor on `Wiki Space`/`Wiki Document`. Visibility is governed only by `is_published` and the per-page `is_private` guest flag.
- `permission_query_conditions` + `has_permission` are **commented out** in `hooks.py`.
- `Wiki Document` is a `NestedSet` (globally-ordered `lft`/`rgt`); owning space resolves via `WikiDocument.get_wiki_space()` (root_group). `Wiki Change Request` already has a `wiki_space` Link.
- `get_wiki_tree(space_id)` (`wiki/api/wiki_space.py`) already calls `space.check_permission("read")`; its internal `get_descendants_of(ignore_permissions=True)` is safe once the space is gated.
- SPA space list/switcher uses `createListResource({doctype:"Wiki Space"})` → standard `get_list` (auto-filtered by `permission_query_conditions`).
- Content read paths needing gating: `get_web_context()` (line ~319, choke point for portal `render()` + `get_page_data()`), the `text/markdown` branch of `WikiDocumentRenderer.render()`, `download_pdf()`. CR merge: `merge_change_request` (~1111) + `get_merge_conflicts`/`resolve_merge_conflict`/`retry_merge_after_resolution`.

## Framework Approach (why so little code)

`permission_query_conditions` filters list/`get_list` queries; `has_permission` guards single-doc `get_doc`/`check_permission`. **Both** are needed and both only *narrow* the static DocType role perms (never widen). We register both for `Wiki Space`, `Wiki Document`, `Wiki Change Request` and let the framework enforce. We **denormalize** `wiki_space` onto each `Wiki Document` (instead of a nested-set range subquery) — less code, uniform with CR, robust to `lft`/`rgt` rebuilds, indexable.

---

## Phase 1 — Schema

1. **New child doctype `Wiki Space Role`** — `wiki/wiki/doctype/wiki_space_role/` (`"istable": 1`, module Wiki).
   - `role` — Link → `Role`, `reqd`, `in_list_view`.
   - `permission_level` — Select `Read\nWrite`, default `Read`, `reqd`, `in_list_view`.
2. **`Wiki Space`** (`wiki/wiki/doctype/wiki_space/wiki_space.json`) — add an "Access Control" section + `roles` field (Table → `Wiki Space Role`), description: *"Leave empty for open access to all logged-in users. Add the **Guest** role for public/anonymous access."* Leave existing `permissions` array unchanged.
3. **`Wiki Document`** (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.json`) — add `wiki_space` Link → `Wiki Space` (`read_only`, `no_copy`, `search_index: 1`); **remove `is_private`** and update `field_order`. Confirm `Wiki User` keeps `read`.

**Exit:** `bench migrate` creates the doctype/fields; roles table editable in the Desk Wiki Space form.

## Phase 2 — Core permissions module + hooks

1. **`wiki/permissions.py`** (new) — module-level functions:
   - `_is_manager(user)`; `_space_role_levels(space)` → `{role: level}` (empty = open).
   - `can_read_space(space, user)` — managers True; empty → `user != "Guest"`; else `bool(user_roles & set(levels))` (any row grants read; `Guest`/`All` rows behave naturally).
   - `can_write_space(space, user)` — managers True; empty → global `Wiki Approver`; else user has a `Write`-level row.
   - `_accessible_space_names(user)` — spaces with no rows **plus** spaces with a row whose role ∈ user roles.
   - Hook fns: `wiki_space_query_conditions`/`wiki_space_has_permission` (read→can_read; write/create/delete→can_write); `wiki_document_query_conditions` (`wiki_space IS NULL OR wiki_space IN (...)`)/`wiki_document_has_permission` (delegate to `doc.wiki_space`); `wiki_cr_query_conditions`/`wiki_cr_has_permission` (delegate to `cr.wiki_space`; CR-doc *write* = space **Read**).
   - Query conditions: `""` for managers, name-IN clause otherwise, `1=0` if none. Escape with `frappe.db.escape`.
2. **`wiki/hooks.py`** — register both dicts for the three doctypes (replace the commented block).

**Exit:** SPA space list + `get_wiki_tree` are auto-gated; bench-console checks (see Verification) pass for Space/Document list filtering and single-doc checks.

## Phase 3 — Content choke-point enforcement

`wiki/frappe_wiki/doctype/wiki_document/wiki_document.py`:
1. Add `check_space_access(self, ptype="read", user=None)` — resolve space (`self.wiki_space` or `get_wiki_space()`), call helper, on failure `frappe.throw(_("Page not found"), frappe.DoesNotExistError)` (404, not PermissionError — don't leak existence to guests).
2. Call `self.check_space_access("read")` in **three** places: `get_web_context()`, the `text/markdown` branch of `WikiDocumentRenderer.render()`, `download_pdf()`.
3. Rewrite `check_guest_access()` to delegate to `check_space_access("read")`; remove all `is_private` references.
4. **Stamp `wiki_space`**: set in `on_wiki_document_update` (uses existing `_get_wiki_space_for_document`) via `frappe.db.set_value(..., update_modified=False)`; re-stamp moved subtrees in `reorder_wiki_documents` (`wiki/api/wiki_space.py`).
   - *As-built:* `on_wiki_document_update` stamps **unconditionally** (only writing when the resolved space differs from the current value). Because clone and merge-apply both create docs via `insert()`/`save()`, those paths fire `on_update` and are stamped automatically — **no explicit stamping was needed in the merge/clone code**. Only `reorder_wiki_documents` (which moves subtrees via raw `db.set_value`, bypassing `on_update`) needs the explicit `stamp_wiki_space_subtree(doc_name)` call after `rebuild_wiki_tree()`.
   - *As-built:* `check_space_access` resolves the space as `self.wiki_space or get_wiki_space()`. The **live `get_wiki_space()` fallback** means gating is correct even when the denormalized stamp is missing or stale (e.g. a doc created before its space row existed), so enforcement never depends on the backfill having run.

**Exit:** unauthorized/guest hits on a restricted page 404 across portal HTML, markdown, and PDF; `wiki_space` populated on save/reorder. ✓

## Phase 4 — Change Request gating

`wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py`:
1. `_can_merge(cr)` → `can_write_space(cr.wiki_space)`. Replace the `_is_manager_or_approver()` guard with it in `merge_change_request`, `get_merge_conflicts`, `resolve_merge_conflict`, `retry_merge_after_resolution` (managers still pass).
2. Gate `create_change_request` / `get_or_create_draft_change_request` on space **Read**. On a fresh space (`main_revision` empty), create the bootstrap revision with manager privileges / `ignore_permissions` so a Read-tier user can raise the first CR.
   - *As-built:* `_can_merge(wiki_space)` is a thin wrapper over `can_write_space`. The bootstrap is a helper `_bootstrap_main_revision(wiki_space)` that runs `create_revision_from_live_tree` under `frappe.set_user("Administrator")` (restored in `finally`) — needed because that path inserts `Wiki Revision`/`Wiki Revision Item` docs a plain `Wiki User` can't create. CR insert itself works for Read-tier users because `Wiki User` has static `create` on `Wiki Change Request` and the CR `has_permission` hook maps create→`can_read_space`.

**Exit:** Read users can create/save CRs but not merge; Write users + managers can merge. ✓

## Phase 5 — Migration (no regression)

`wiki/wiki/doctype/wiki_space/patches/backfill_space_access.py` (+ `patches.txt`, `[post_model_sync]`), run after schema sync:
1. **Denorm backfill** — for each `Wiki Space` with a `root_group`, set `wiki_space` on all docs in `[root.lft, root.rgt]` (one `UPDATE` per space).
2. **Guest-flag migration** — for each space an admin hasn't already configured (skip if it already has role rows): if the space had **any** non-private published doc → add a `Guest` **Read** row (preserves public access); if **all** published docs were private → add an `All` **Read** row (login required); no published docs → leave empty.

> **As-built — no pre-sync sequencing needed.** The original plan worried about reading `is_private` "before the column is dropped." In practice **Frappe never drops a DB column when a field is removed from the DocType meta** — it only stops exposing it. So the legacy `is_private` data is still present after schema sync, and the patch reads it via **raw SQL** as an ordinary `[post_model_sync]` patch (which is also where it must run, since it needs the `wiki_space` column and the `Wiki Space Role` doctype to exist). A `frappe.db.has_column("Wiki Document", "is_private")` guard skips the guest-flag step on fresh installs that never had the column. Child role rows are inserted directly (`Wiki Space Role` doc with `parent`/`parentfield` set) rather than re-saving each parent, for speed and to avoid re-validating the space.

**Exit:** after `bench migrate`, previously-public pages stay guest-reachable, `wiki_space` populated everywhere; patch is idempotent. ✓

## Phase 6 — Frontend

`frontend/` (run `yarn build` from `frontend/` after edits):
1. **Space list/switcher** — auto-filtered, **no change**.
2. **Roles editor** — surface the `roles` table in the space settings view (Desk form works automatically; SPA gets a small grid on the Wiki Space doc resource). Remove any page-level `is_private` toggle.
   - *As-built:* the roles editor lives in the **Space Settings** dialog's Permissions tab (`SpaceSettings/PermissionsPanel.vue`) — add/remove rows; role picker from a `Role` list resource; inline Read/Write select. It saves via two new whitelisted methods in `wiki/api/wiki_space.py`: `get_space_roles(space_id)` and `update_space_roles(space_id, roles)` — the latter `check_permission("write")`s the space (so only managers / Write-tier users edit access). Client `set_value` is **not** used (unreliable for child tables). The page-level Private toggle (`WikiDocumentSettings.vue`) and the lock icon (`WikiDocumentPanel.vue`) were removed.
   - *Polish:* the editor controls (Add/Remove/Save) are gated client-side behind `get_space_capabilities.can_write` (`canManageAccess`), so a Read-tier user who opens Space Settings sees the configured rows **read-only** with an "Only space admins can change access control." hint instead of controls that would 403 on save. Enforcement stays server-side in `update_space_roles`.
3. **Merge button UX** — add `wiki.api.get_space_capabilities(space)` → `{can_read, can_write}` (thin wrapper over the helpers); disable/hide Merge in `ContributionReview.vue` when `!can_write`. Enforcement stays server-side.
   - *As-built:* `canReview` in `ContributionReview.vue` now derives from `capabilities.can_write` (fetched via a `watch` on `changeRequest.doc.wiki_space`), replacing the old `isManager` check — so space Write-tier users get the Merge UI too, while managers still qualify (`can_write_space` returns True for them).

**Exit:** Read-tier users see no Merge button; Write-tier users + managers do; roles editable from the SPA and Desk. ✓

## Phase 7 — Search leakage (required follow-up)

The SQLite/web search index (`WikiSQLiteSearch`, `index_web_pages_for_search`) is built without user context and can surface titles/snippets from restricted spaces. **Post-filter search hits** by resolving each hit's `wiki_space` through `can_read_space`.

- *As-built:* the filter lives in the whitelisted search endpoint `wiki/frappe_wiki/doctype/wiki_document/search.py` (`_filter_hits_by_read_access`), not in the index/engine. It batches the hits' `wiki_space` in one `get_all`, caches `can_read_space` per distinct space, and keeps orphan hits (no `wiki_space`) — matching the content-gate's orphan-readable rule. `total` is recomputed as the post-filter count.

---

## Edge Cases

- **Orphan documents** (`wiki_space IS NULL`): read-allowed for all (preserves chromeless-page behavior), write-restricted to managers.
- **`default_wiki_space`** a user can't read: SPA shows empty/login state; router must handle "no accessible spaces" gracefully.
- **`get_descendants_of(ignore_permissions=True)`** in `get_wiki_tree`: stays safe (space gated first).
- **Floor interaction**: every logged-in user has `Wiki User` (read floor); a user with an arbitrary role (e.g. `HR`) is allowed/denied purely by the space's role rows. A plain `Wiki User` has no static `write` on `Wiki Space`, which is why CR creation on a fresh space must bootstrap privileged (Phase 4.2).
- **`Guest` vs `All` semantics (confirmed):** on this site `frappe.get_roles(user)` returns `Guest` for *every* user (anonymous and logged-in), but **not** `All` for anonymous. So a `Guest` Read row = public to everyone (incl. logged-in), and an `All` Read row = logged-in only — exactly the intended distinction. Open spaces (no rows) are gated by the explicit `user != "Guest"` check, not by roles.

## Implementation Notes (as-built)

Deviations from the original plan, discovered/decided during implementation:

1. **`is_private` column is never dropped** by Frappe on field removal, so the Phase 5 guest-flag migration is a plain `[post_model_sync]` patch reading the legacy column via raw SQL (guarded by `has_column`) — no pre-sync sequencing. (See Phase 5.)
2. **`check_space_access` falls back to live `get_wiki_space()`** when the denormalized `wiki_space` is missing/stale, so enforcement never depends on the backfill. (See Phase 3.)
3. **Stamping rides on `on_update`** for create/clone/merge (all insert/save); only reorder needs an explicit subtree re-stamp. No stamping code was added to the merge/clone paths. (See Phase 3.)
4. **Two extra SPA APIs** beyond `get_space_capabilities`: `get_space_roles` / `update_space_roles` (`wiki/api/wiki_space.py`) back the SPA roles grid; client `set_value` is unreliable for child tables. (See Phase 6.)
5. **Bootstrap runs as Administrator** (`_bootstrap_main_revision`) so a Read-tier user can seed a fresh space's first revision. (See Phase 4.)
6. **Existing tests reconciled to the new model:** the `is_private`/`PermissionError` guest-private tests now assert space-role behavior + `DoesNotExistError` (404); the test space helper gained a `roles=` kwarg; markdown-negotiation tests mark their space `Guest`-readable.

## Verification

Verified phase-by-phase on **wiki.localhost** via a temporary `bench execute` harness (since removed) and the existing test suites.

**bench console / execute** (per-phase, all green):
- Space `S` with `HR`(Read). `reader_hr` (Wiki User+HR): `can_read_space("S")` True, `can_write_space` False, `has_permission("Wiki Space","read",doc="S")` True / `"write"` False, `S` in `get_list("Wiki Space")` (note: `get_all` bypasses query conditions — must use `get_list`).
- `finance_only` (Wiki User+Finance): `S` absent from `get_list`; `has_permission("Wiki Document","read", doc=<doc in S>)` False; doc not in `get_list("Wiki Document")`.
- Open space (no rows): logged-in True, Guest False. Space with `Guest`(Read): `can_read_space` True as Guest.
- `writer` (Wiki User + HR-Write on its space): `can_write_space` True.
- **Phase 3:** fresh doc under `S` auto-stamped `wiki_space=S`; `finance`/Guest `get_web_context`/`check_space_access` → `DoesNotExistError` (404); reader allowed; cross-space reorder re-stamps the moved doc.
- **Phase 4:** `finance` `create_change_request(S)` → PermissionError; `reader` creates a CR on a fresh `S` (bootstrap) but `merge_change_request` → PermissionError; `writer`/manager `_can_merge` True.
- **Phase 6:** `get_space_capabilities` returns `{can_read,can_write}` per user; `update_space_roles` denied for reader, applied for manager.
- **Phase 7:** `_filter_hits_by_read_access` drops `S` hits for `finance`/Guest, keeps `Guest`-space + orphan hits, unfiltered for manager.

**Migration (`bench migrate`):** patch stamped 7001 docs, left 48 orphans `NULL`, added 349 `Guest`-Read rows (no `All` rows on this dataset — its only private docs are orphans outside any space), and left admin-configured spaces untouched. Re-running `bench migrate` is idempotent (counts unchanged).

**Test suites (all pass):** `test_permissions` (27 — dedicated regression matrix for the helpers + hook entry points + role-editor API, replacing the removed bench harness), `test_wiki_change_request` (67), `test_wiki_document` (27 integration + 41 unit), `test_wiki_space` (5). `yarn build` clean; `ruff`/`pre-commit` clean.

**Not yet run:** the end-to-end HTTP/browser matrix below (left for an agent-browser pass).

- `finance_only` → `/wiki/<S page>` 404 (incl. `Accept: text/markdown` + `download_pdf`); switcher omits S.
- `reader_hr` → 200 content; open/save a CR; **Merge button absent**; direct `merge_change_request` → error.
- `writer` → Merge present; merge succeeds.
- Guest → restricted space 404; space with `Guest`(Read) → public 200.
- Manager → full access; `get_list` unfiltered.

## Files Touched (summary)

| File | Change |
|---|---|
| `wiki/wiki/doctype/wiki_space_role/*` *(new)* | Child doctype (`role`, `permission_level`) |
| `wiki/wiki/doctype/wiki_space/wiki_space.json` | Add `roles` table + Access Control section |
| `wiki/frappe_wiki/doctype/wiki_document/wiki_document.json` | Add `wiki_space` (indexed); remove `is_private` |
| `wiki/permissions.py` *(new)* | Helpers + 6 hook entry points |
| `wiki/hooks.py` | Register `permission_query_conditions` + `has_permission` |
| `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py` | `check_space_access` (live-resolve fallback) + 3 read gates + `check_guest_access` delegate + `stamp_wiki_space`/`stamp_wiki_space_subtree` |
| `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py` | `_can_merge` on 4 merge fns + CR-create read gate + `_bootstrap_main_revision` |
| `wiki/api/wiki_space.py` | Re-stamp `wiki_space` on reorder + `get_space_roles` / `update_space_roles` |
| `wiki/api/__init__.py` | `get_space_capabilities(space)` → `{can_read, can_write}` |
| `wiki/wiki/doctype/wiki_space/patches/backfill_space_access.py` + `patches.txt` (`[post_model_sync]`) | Denorm backfill + guest-flag migration (raw-SQL `is_private`, `has_column` guard) |
| `wiki/wiki/doctype/wiki_page/wiki_page.py` | Drop legacy `is_private` write in `_migrate_to_wiki_document` |
| `frontend/src/pages/ContributionReview.vue` | Merge UI gated by `get_space_capabilities.can_write` |
| `frontend/src/pages/SpaceDetails.vue` | Space Settings now a Builder-style dialog (vertical nav) hosting `SpaceSettings`; keeps the space resource + route/clone sub-dialogs. Dropped the sidebar resize handle's `z-10` so the modal overlay sits above it |
| `frontend/src/components/SpaceSettings/SpaceSettings.vue` *(new)* | Settings shell: left nav (General / Permissions) + active panel, Builder-styled |
| `frontend/src/components/SpaceSettings/GeneralPanel.vue` *(new)* | Published / feedback switches + Update Routes / Clone actions |
| `frontend/src/components/SpaceList.vue` | New spaces (published by default) seed `Guest`(Read) at creation (public; Guest covers anon + logged-in); admins refine in Permissions |
| `wiki/wiki/doctype/wiki_space/patches/seed_space_roles_from_published.py` + `patches.txt` | Make existing empty spaces explicit from `is_published`: published → `Guest` Read (public), unpublished → `All` Read (logged-in only). `get_roles()` returns `Guest` for every user, so `Guest`=everyone and `All`=logged-in-only; matches the `backfill_space_access` convention. Skips already-configured spaces; managers bypass (no manager row). Empty-roles still = open-to-logged-in fallback |
| `frontend/src/components/SpaceSettings/PermissionsPanel.vue` *(new)* | Access-control roles as a CRM/LMS-styled table; Access is an inline Read/Write Select (static Badge when read-only); add-role via an in-flow searchable picker (select → Add; rendered without teleport so it stays clickable inside the reka-ui modal); Save below the table, disabled until dirty; emits dirty state for the shell's "Unsaved changes" badge (`get_space_capabilities`/`update_space_roles`) |
| `frontend/src/components/WikiDocumentSettings.vue`, `WikiDocumentPanel.vue` | Remove page-level Private toggle + lock icon |
| `wiki/frappe_wiki/doctype/wiki_document/search.py` | `_filter_hits_by_read_access` post-filter (Phase 7) |
| `…/test_wiki_document.py`, `…/wiki_space/test_wiki_space.py` | Reconcile to new model: `roles=` helper kwarg, 404 (not PermissionError), drop `is_private` asserts |

Run `yarn build` from `frontend/` after the Vue changes.
