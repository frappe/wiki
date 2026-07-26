# Editable Page Route

Date: 2026-07-26
Status: **Implemented** (2026-07-26). Backend unit tests green (4 new/updated cases in `test_wiki_change_request.py`), frontend build clean. e2e spec added but not run locally — the dev bench serves the main checkout, not this worktree; CI runs it. See [Verification](#verification).
Issue: [frappe/wiki#714](https://github.com/frappe/wiki/issues/714) — "Route should not be auto-created"

## Goal

Today the "New page" dialog collects only a **Title**. The URL is derived behind the author's back from the folder hierarchy, and a later title rename silently rewrites it. Authors never see the URL they are creating and cannot choose it.

Surface the route in the create dialog as a **prefilled but editable field** — the same interaction the "New space" dialog already has (`SpaceList.vue`): it auto-populates as you type the title, and stops auto-populating the moment you edit it by hand.

Decisions taken with the issue reporter:

- The prefilled default stays **exactly what the backend derives today**, folder hierarchy included (`docs/guides/advanced/caching`). Authors who want a flat URL now just delete the middle segments.
- Once a page exists, its route is **sticky**: renaming the title no longer moves the URL. The route changes only through the existing "Edit route" control.
- Collisions are caught **in the create dialog** (live availability check), not silently suffixed and not deferred to merge time.
- **Existing documents are untouched.** No migration patch — the app has no redirect table, so rewriting live routes would 404 every existing URL.

## Current State

**Backend — two route builders, both hierarchy-based:**

- `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py:212` `set_route()` — live-document builder, guarded by `if not self.route`, so an explicitly supplied route always wins. Builds `<wiki space route>/<ancestor slugs…>/<own slug>`, dropping the root group (the space route covers it).
- `.../wiki_change_request/wiki_change_request.py:219` `_compute_cr_route()` — the same shape for change-request items. Used by `_create_cr_item` (`:377`) when no route is passed, and re-run by `_update_cr_item(recompute_route=True)` (`:419-430`) whenever title/slug change — this is the silent-rename-rewrite.
- Slug rule everywhere: `cleanup_page_name(title).replace("_", "-")` (`wiki_document.py:173`).
- `validate_unique_route_for_leaves` (`wiki_document.py:144`) throws on duplicate routes for non-groups — but only at **merge** time, which is far too late to be actionable.
- The batch `create_node` op already forwards `route` (`wiki_change_request.py:966`); the legacy `create_cr_page` RPC (`:846`) does not accept one.

**Frontend — no route anywhere in the create flow:**

- Create dialog `frontend/src/components/WikiDocumentList.vue:67-90` — Title (+ icon for tabs) only.
- Dialog state/handler `frontend/src/composables/useTreeDialogs.js:49` (`openCreateDialog`), `:131` (`createDocument`).
- `frontend/src/stores/draftWorkspace.js:455` `createNode` — *predicts* the route as `slugify(title)` for the optimistic node (`:473`) and page buffer (`:493`), sends no route (`:545-557`), then overwrites with the server's value (`:563-568`).
- Route becomes editable only **after** creation: `WikiDocumentPanel.vue:112` / `DraftContributionPanel.vue:105`.

**The pattern to copy — `frontend/src/components/SpaceList.vue:557-581`:** the Route field is deliberately not `v-model`-bound; it uses `:modelValue` + `@update:modelValue="handleRouteInput"` so each keystroke is inspected before landing in state, and a `routeManuallyEdited` latch stops the title watcher from clobbering a hand-typed value.

## Non-Goals

- No migration of existing routes, no redirects for old URLs.
- No change to the derived route *shape* — only to who gets the last word on it.
- No redesign of the post-create "Edit route" dialogs (they inherit backend sanitisation for free).
- No route field for external links (separate dialog; they have `external_url`, not a route).

## Design

### Backend

1. **`sanitize_route(route)`** — new module-level helper in `wiki_document.py`, imported by the CR module. Splits on `/`, runs each segment through the app's existing slug rule, drops empties, rejoins. Every client-supplied route passes through it; the client is never trusted.

2. **`check_route_available(wiki_space, route, cr_name=None, exclude_doc_key=None)`** — new whitelisted read. Returns `{"available": bool}`, checking the live `Wiki Document` table (non-groups, mirroring `validate_unique_route_for_leaves`) and — when a CR exists — the effective CR item map (non-deleted non-groups), excluding `exclude_doc_key`. Debounced from the dialog.

   `cr_name` is optional and the API is scoped to the space rather than a CR because the draft CR is created lazily: the create dialog can open before one exists.

3. **Accept the route on create.** Sanitise `op.get("route")` in the batch `create_node` op; add a `route` param to `create_cr_page` so the legacy path matches.

4. **Sticky route.** Delete the `recompute_route` parameter, its recompute block and the `recompute_route=True` call site in the batch `update_node` op.

`set_route()` is left alone — it stays the fallback for documents created without a route (desk, git sync, install fixtures).

### Frontend

The route **prefix** is derived in the frontend rather than through a backend endpoint. A group's route already carries the space route plus every ancestor slug, so a child's prefix is simply the parent's route — the one exception is the space root, whose own route is a bare slug and where the space route stands in. This costs no round-trip, works when the parent group is itself an unsaved draft, and makes a child sit under the parent's *visible* URL rather than under a path recomputed from slugs.

5. **`useTreeDialogs.js`** — new `createRoute` / `createRoutePrefix` / `createRouteError` / `routeManuallyEdited` state. `openCreateDialog` derives the prefix and resets the latch; a `createTitle` watcher fills `createRoute` while the latch is down; `handleCreateRouteInput` raises it; a debounced availability check fills `createRouteError`; `createDocument` refuses to submit while an error is showing and passes `route` through.

6. **`WikiDocumentList.vue`** — Route `FormControl` under Title, `:modelValue` + `@update:modelValue`, with inline error text. Shown for pages, groups and tabs.

7. **`draftWorkspace.js` / `changeRequest.js`** — thread `route` through `createNode` → queued payload → batch op / `create_cr_page`, and use it for the optimistic node and page buffer instead of the `slugify(title)` guess. Reuse the shared `slugify` from `stores/draftWorkspace/utils.js:4`.

## Verification

- Backend unit tests (`test_wiki_change_request.py`): explicit route honoured; messy route sanitised; **regression** — `test_apply_cr_operations_update_node_keeps_route` (the former `..._recomputes_route`, inverted) confirms a title rename leaves the route untouched, verified by temp-reverting the fix; `check_route_available` catches both a live duplicate and a CR-only duplicate. All four pass; the module's remaining errors are local `QueryDeadlockError` flake present on `develop` too.
- e2e (`e2e/tests/page-route-editable.spec.ts`): create a page inside a nested group → the Route field prefills with the hierarchy path and tracks the title → overwrite it → save → the custom route is what the tree and the panel report.
- Manual: rename the page afterwards and confirm the URL does not move.
