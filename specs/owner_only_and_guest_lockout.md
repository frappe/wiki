# Owner-Only Access Control + Guest Lockout

Date: 2026-08-01
Status: In progress.

## Goal

1. **No Guest (anonymous) access anywhere.** Every wiki route — the `/wiki-app` SPA and the server-rendered public page path — requires login. Anonymous visitors are redirected to `/login`.
2. **"Owner Only" checkbox** on `Wiki Document` and `Wiki Space`, visible only to users with the `Admin` role. When checked, the record is readable only by its owner and `Admin`-role users, and is completely hidden (no read access, not just UI-hidden) from everyone else — in particular `Technician`-role users.

## Settled semantics

- **Guest is removed as an access mechanism, full stop.** Today a `Wiki Space` can be made publicly readable by adding the built-in `Guest` role to its `Wiki Space Role` table (see `role_based_space_access_control.md`). This capability is removed: `Guest` never grants read access, regardless of configured role rows. Existing `Guest` rows are left in the database (inert) rather than migrated/deleted.
- **`Admin`** is added to the existing manager bypass (`MANAGER_ROLES` in `wiki/permissions.py`, alongside `System Manager`/`Wiki Manager`) — Admins see and can do everything, including toggling Owner Only.
- **Owner Only is layered, not a replacement.** Existing per-space `Wiki Space Role` / open-space-default rules still decide baseline visibility for everyone exactly as today. Owner Only then *additionally* restricts on top of that for non-owner/non-Admin users. A document is hidden from a user if its own `owner_only` is set **or** its parent space's `owner_only` is set (OR/union composition — either flag is enough to trigger the restriction, and the people who can still see it are the union of `{document owner, space owner, Admin-role users}`).
- **`Admin` and `Technician`** are ordinary Frappe Roles referenced directly in the `Wiki Document`/`Wiki Space` `permissions` arrays — not defined via fixture or patch, matching how `Wiki Manager`/`Wiki User` already exist in this codebase (Frappe auto-creates a `Role` record for any name referenced in a DocType's permission table on `bench migrate`). If these roles already exist on the target site, Frappe reuses them.
- **Field visibility** for `owner_only` uses Frappe's `permlevel` mechanism: the field is `permlevel: 1`, and only the `Admin` permission row is granted read/write at that level — hides it from Desk form view and the frontend for everyone else. This is narrower than the enforcement bypass: `System Manager`/`Wiki Manager` bypass Owner Only *enforcement* (via `MANAGER_ROLES`) but do not see the *toggle* unless they separately hold `Admin`.
- **No-leak principle preserved.** Denial for a restricted/owner-only page still raises `frappe.DoesNotExistError` (404), matching the existing convention in `check_space_access`. Guest denial on the server-rendered path redirects to `/login?redirect-to=<path>` instead of rendering or 404ing, so a Guest can never distinguish "doesn't exist" from "exists but restricted."

## Enforcement points

All server-side, extending the existing `permission_query_conditions` / `has_permission` hook architecture (`wiki/hooks.py` → `wiki/permissions.py`) — no parallel mechanism introduced.

- `wiki/permissions.py`: blanket Guest lockout at the top of all six hook entry points; removal of the Guest-role-row bypass in `can_read_space`/`_accessible_space_names`; new `_space_owner_only_blocks`/`_document_owner_only_blocks` helpers wired into `can_read_space`, `can_write_space`, `_accessible_space_names`, `wiki_document_has_permission`, `wiki_document_query_conditions`.
- `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py`: `check_space_access` gains a document-level Owner Only check that runs even for orphan documents; `WikiDocumentRenderer.render()` redirects Guest to `/login` before rendering; `get_page_data`, `download_pdf`, `get_space_tabs` lose `allow_guest=True`; `build_nested_wiki_tree`/`get_space_tabs` exclude `owner_only=1` items from the (globally cached) sidebar tree and tab bar so a restricted title never leaks into shared navigation.
- `wiki/frappe_wiki/doctype/wiki_document/search.py`: loses `allow_guest=True`; per-hit Owner Only filter added alongside the existing space-visibility filter.

## Out of scope

- `Wiki Change Request` gets space-level Owner Only for free (it already delegates to `can_read_space`), but no document-level Owner Only concept — not requested.
- `wiki_feedback.py`'s guest-whitelisted submission endpoint and `wiki.api.get_translations` are also `allow_guest=True` but aren't content-read paths; left untouched.

## Migration note

`owner_only` defaults to unchecked on every existing record (no behavior change there). Guest-publishing removal is breaking for any space currently relying on a `Guest` row in `Wiki Space Role` — run this before deploying to see which spaces are affected:

```python
rows = frappe.get_all("Wiki Space Role", filters={"role": "Guest", "parenttype": "Wiki Space"}, fields=["parent"])
frappe.get_all("Wiki Space", filters={"name": ("in", [r.parent for r in rows])}, fields=["name", "space_name", "route", "is_published"])
```

See `role_based_space_access_control.md` for the superseded-language note on the original Guest-publishing feature.
