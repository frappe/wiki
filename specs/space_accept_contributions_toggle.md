# Per-Space "Accept Contributions" Toggle

Date: 2026-06-29
Status: **Implemented & verified** on wiki.localhost (2026-06-29). All 6 phases
landed; `wiki.test_permissions` (34 tests) and
`wiki.frappe_wiki.doctype.wiki_change_request.test_wiki_change_request` (85
tests) pass. The reader `can_edit` flip was verified for Guest vs manager with
the toggle on/off; the new enforcement tests were confirmed to fail on a
temp-reverted toggle before restoring.

## Goal

Let admins turn off contributions (Change Requests) for a Wiki Space. When off, the
**Edit** button is hidden from read-only viewers in the public reader and the
backend refuses to create Change Requests for them. Users with **Write/merge
access** (Wiki Managers, Write-tier space roles, System Manager) can always edit,
regardless of the toggle. The toggle is **on by default** (backward compatible).

The reader's other actions (Copy as Markdown, Download PDF, Open in ChatGPT/Claude)
stay available to everyone. When the Edit button is hidden, **Copy** becomes the
primary action button in the page header.

## Semantics

- `Wiki Space.allow_contributions` (Check, default **1**).
- **Can contribute** (raise / edit a Change Request) iff:
  - user can *write* the space (manager / Write-tier) — always; **OR**
  - the space accepts contributions **and** the user can *read* the space.
- **Show Edit button** in the reader iff: space accepts contributions **OR** user can
  write the space. (Anonymous Guests still see Edit on a contributions-on space and
  get the existing login redirect — unchanged.)

Note the asymmetry: the reader's *show-edit* predicate uses `accepts OR can_write`
(so anonymous discovery is preserved), while the *can-contribute* gate additionally
requires read access (Guests can't actually raise CRs on open spaces, as today).

## Current State

- `permissions.py` has `can_read_space` / `can_write_space` and the
  `has_permission` / `permission_query_conditions` hooks. Read = view + raise CRs;
  Write = additionally merge.
- The reader (`templates/wiki/document.html` + `macros/buttons.html`) always renders
  the `[✏ Edit ▾]` split button (except orphan/chromeless docs). No per-user gate.
- CR creation: `create_change_request` / `get_or_create_draft_change_request`
  (`wiki_change_request.py`) gate on `can_read_space`.
- `wiki.api.get_space_capabilities` returns `{can_read, can_write}` for the SPA.
- SPA settings: `SpaceSettings.vue` → `PermissionsPanel.vue` (access-control roles,
  saved via the `update_space_roles` whitelisted method, write-gated).

## Plan (tracer bullet: schema → backend gate → reader → API → settings UI → tests)

### Phase 1 — Schema
- Add `allow_contributions` (Check, default `1`) to `Wiki Space` in the Access
  Control tab, after `roles`. Label "Accept Contributions", with a description.
- Migration patch `set_allow_contributions_default` to backfill existing spaces to
  `1` (registered in `patches.txt`).

### Phase 2 — Backend permission gate
- `permissions.py`:
  - `_space_accepts_contributions(space)` — reads the flag; **None/missing ⇒ True**
    (backward compatible).
  - `can_contribute_to_space(space, user)` — `can_read_space` and
    (`can_write_space` or `_space_accepts_contributions`).
  - `wiki_cr_has_permission`: route **write** ptypes through `can_contribute_to_space`
    (single choke point covering `cr.insert()` and all CR page mutations); reads
    stay on `can_read_space`.
- `wiki_change_request.py`: in `create_change_request` and
  `get_or_create_draft_change_request`, keep the read check, then add a contribution
  check that throws a clear "not accepting contributions" PermissionError for
  read-only users when the toggle is off.

### Phase 3 — Reader (server-rendered)
- `wiki_document.py` `get_web_context`: add `can_edit = accepts OR can_write_space`
  (False for orphan/chromeless docs).
- `macros/buttons.html`: `page_actions_dropdown(show_edit=True)` — when `show_edit`,
  render the Edit `<a class="wiki-edit-link">` primary as today; otherwise render a
  **Copy** primary `<button>` (clipboard/check state, no `wiki-edit-link` class).
- `document.html`: pass `show_edit=can_edit` (mobile + desktop) and only include the
  redundant "Copy page" dropdown item when `can_edit` (Copy is primary otherwise).

### Phase 4 — Capabilities API
- `get_space_capabilities`: add `can_contribute` to the returned dict.

### Phase 5 — Settings UI (Permissions panel)
- `api/wiki_space.py`: `set_space_contributions(space_id, allow)` — write-gated
  (`check_permission("write")`), sets the flag.
- `PermissionsPanel.vue`: an "Accept contributions" Switch below the roles table.
  Editable for `canManageAccess` (write), read-only otherwise. Saves immediately via
  `set_space_contributions`. Coerce null → on for legacy rows.

### Phase 6 — Tests
- `test_permissions.py`: `can_contribute_to_space` matrix (manager / write-tier /
  read-tier × toggle on/off) and that CR creation is blocked for a read-tier user
  when the toggle is off but allowed for a write-tier user.

## Out of scope (for now)
- Deep SPA editor read-only UX when a read-tier user reaches `/wiki/...` directly:
  backend already throws and the reader hides the entry point. Capability
  (`can_contribute`) is exposed for a future SPA polish.
