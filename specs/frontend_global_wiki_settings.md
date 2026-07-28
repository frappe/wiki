# Global Wiki Settings in the Frontend

Date: 2026-06-29
Status: **Implemented**

> Reconciliation: implemented on `feat/frontend-wiki-settings` across all five
> phases. One deviation from the plan: the dialog is opened on the GitHub-return
> path via a reactive query watcher in `MainLayout.vue` (not `onMounted`) because
> the app mounts before the router resolves the initial route. A small reusable
> `SettingToggle.vue` was added to share the switch-row layout/save across panels.

## Goal

Today the only way to change global **Wiki Settings** is to leave the Wiki SPA and
go into the Frappe Desk (`/app/wiki-settings`). We already have a polished
**per-space** settings experience in the frontend (the gear → `SpaceSettings`
dialog). This brings the **global** `Wiki Settings` Single DocType into the
frontend the same way — a modal `Dialog` opened from the sidebar menu — so an
admin never has to touch the Desk.

**Scope (confirmed):**
- Migrate the *existing* `Wiki Settings` fields only — no new appearance/design
  fields (logos/favicon/navbar stay per-space, by design).
- GitHub App tab **included**, with write-only handling for its Password secrets.
- Presentation: a modal `Dialog`, mirroring the existing Space Settings UX.

We mirror the app's own established pattern (`SpaceSettings.vue`) rather than
importing the CRM/LMS settings shell, for visual + code consistency.

## Existing pattern we reuse

- Shell: `frontend/src/components/SpaceSettings/SpaceSettings.vue` — `Dialog` body,
  left rail of tab `Button`s + a right panel switched by `v-if`.
- Per-field toggle save: `GeneralPanel.vue` uses
  `props.space.setValue.submit({ field: value })` and reverts the local ref on
  error. Copied exactly.
- Data resource: `createDocumentResource({ doctype, name, auto: true })` for a
  Single (see `SpaceDetails.vue:291`).
- Admin gate: `useUserStore().isWikiManager` (`frontend/src/stores/user.js:20`).
- Sidebar menu: `Sidebar.vue` `header.menuItems` (today Toggle Theme / Log out);
  mobile equivalent in `MobileTopNav.vue`.

## Fields to surface

`Wiki Settings` (`wiki/wiki/doctype/wiki_settings/wiki_settings.json`), grouped by
its existing Tab Breaks:

- **General:** `enable_table_of_contents` (Check), `auto_convert_images_to_webp`
  (Check)
- **Feedback:** `enable_feedback` (Check), `feedback_submission_limit`
  (Int, depends on `enable_feedback`)
- **Header & Robots:** `head_html` (Code/HTML)
- **GitHub Sync:** `github_app_id`, `github_app_client_id`,
  `github_app_public_link` (Data — round-trip normally) +
  `github_app_client_secret`, `github_app_private_key`, `github_webhook_secret`
  (**Password — do NOT round-trip via the doc API**)

Deliberately **not** surfaced — dead `Wiki Settings` fields with no runtime
consumer in v3: `default_wiki_space` (only ever written by an old sidebar
migration patch), `ask_for_contact_details`, and `javascript` (only `head_html`
is actually injected, via `wiki_document.py` → `templates/wiki/layout.html`).
The DocType still carries these columns; removing them is a separate cleanup.

## Implementation (tracer-bullet phases)

### Phase 1 — Backend: permissions + GitHub secret API

1. **Permission alignment.** Frontend gate is `isWikiManager`
   (`Wiki Manager` / `System Manager`), but the DocType currently grants
   read/write only to `System Manager` + `Wiki Approver`. Add a **`Wiki Manager`
   read+write perm row** to `wiki_settings.json` so the gated UI can save.
2. **GitHub secret presence + write-only API** in `wiki/api/github.py` (next to
   the existing whitelisted helpers ~line 488), since Password fields never come
   back from a normal doc read:
   - `get_app_config()` → `{ app_id, client_id, public_link, has_client_secret,
     has_private_key, has_webhook_secret }`. Gate on
     `has_permission("Wiki Settings", "read")`. Booleans only — never return
     secret values.
   - `save_app_credentials(client_secret?, private_key?, webhook_secret?)` →
     write-only; only overwrites a secret when a non-empty value is passed
     (blank = leave as-is). Gate on `has_permission("Wiki Settings", "write")`.
     Reuse the save shape of `store_app_credentials` (github.py:461).
3. **Redirect the manifest flow back to the SPA.** `manifest_redirect.py`
   currently bounces to `/app/wiki-settings?github_app_created=1` (Desk). Change
   it to `/wiki?github_app_created=1` so the one-click "Create GitHub App" flow
   returns to the SPA; the frontend reads that param to re-open the dialog on the
   GitHub tab.

### Phase 2 — Frontend shell + General panel (end-to-end tracer bullet)

New folder `frontend/src/components/WikiSettings/`:
- `WikiSettings.vue` — shell cloned from `SpaceSettings.vue`: left-rail tab
  `Button`s (General / Feedback / Header & Robots / GitHub App) + right panel
  switch. Owns one shared
  `createDocumentResource({ doctype: 'Wiki Settings', name: 'Wiki Settings', auto: true })`,
  passed to panels as a `settings` prop (mirrors how `space` is passed).
- `GeneralPanel.vue` — `Switch` rows for `enable_table_of_contents` /
  `auto_convert_images_to_webp` saved via `settings.setValue.submit(...)` with
  revert-on-error. `default_wiki_space` via `Autocomplete`/`Select`, options from
  `createResource({ url: 'wiki.wiki.doctype.wiki_settings.wiki_settings.get_all_spaces' })`.

Entry point (wired in this phase so the bullet is testable):
- Small `useWikiSettings` composable (or a ref in `MainLayout.vue`) holding
  `showWikiSettings` — like CRM's global `showSettings`.
- Mount `<Dialog><WikiSettings/></Dialog>` once in `MainLayout.vue` (desktop +
  mobile).
- Add a **Settings** item to `Sidebar.vue` `header.menuItems`, shown only when
  `userStore.isWikiManager`, `onClick` → `showWikiSettings = true`. Mirror in
  `MobileTopNav.vue`.
- Handle `?github_app_created=1` on mount → open dialog to the GitHub tab.

After Phase 2: an admin opens Settings, flips a General toggle, and it persists.

### Phase 3 — Feedback + Header/Robots panels

- `FeedbackPanel.vue` — `enable_feedback` / `ask_for_contact_details` switches;
  `feedback_submission_limit` as `FormControl type="number"` shown only when
  `enable_feedback` (matches the DocType `depends_on`).
- `CodePanel.vue` (Header & Robots) — `head_html` + `javascript` as monospace
  `FormControl type="textarea"` with an explicit **Save** button using
  `settings.save.submit()` and an "Unsaved changes" `Badge` from
  `settings.isDirty`. *(Plain textarea for the bullet; CodeMirror later.)*

### Phase 4 — GitHub App panel

`GitHubAppPanel.vue`:
- Data fields (`github_app_id`, `github_app_client_id`, `github_app_public_link`)
  bound to the shared `settings` resource.
- Secrets: load presence via `get_app_config`; render each as "•••• configured" /
  "Not set" with an edit field; write via `save_app_credentials`. Never display
  stored secret values.
- **Create GitHub App** button → `window.open('/github/new_app', '_blank')` (same
  as the Desk client script `wiki_settings.js:8`). On return via the redirect
  param, reload the resource + `get_app_config`.
- Optional: surface connection state via `wiki.api.github.is_connected`.

### Phase 5 — Tests & build

- **Python unit** (`test_wiki_settings.py`): `get_app_config` presence booleans &
  no secret leakage; `save_app_credentials` writes only non-empty values and is
  permission-gated; a `Wiki Manager` can read/write after the perm row is added.
  Temp-revert to confirm the test fails without the fix (CLAUDE.md regression
  rule).
- **E2E (Playwright)**: as a Wiki Manager, open the dialog from the menu, toggle a
  General setting, reload, assert persisted; assert a non-manager doesn't see the
  Settings item.
- `yarn build` in `frontend/` after frontend edits; `bench --site wiki.localhost
  migrate` for the JSON perm change.

## Files to create / modify

**Create**
- `frontend/src/components/WikiSettings/WikiSettings.vue`
- `frontend/src/components/WikiSettings/GeneralPanel.vue`
- `frontend/src/components/WikiSettings/FeedbackPanel.vue`
- `frontend/src/components/WikiSettings/CodePanel.vue`
- `frontend/src/components/WikiSettings/GitHubAppPanel.vue`
- `frontend/src/composables/useWikiSettings.js` (global open state) — optional

**Modify**
- `wiki/wiki/doctype/wiki_settings/wiki_settings.json` (add `Wiki Manager` perm)
- `wiki/api/github.py` (`get_app_config`, `save_app_credentials`)
- `wiki/www/github/manifest_redirect.py` (redirect → SPA)
- `frontend/src/layouts/MainLayout.vue` (mount dialog)
- `frontend/src/components/Sidebar.vue` + `MobileTopNav.vue` (menu entry, gated)
- `wiki/wiki/doctype/wiki_settings/test_wiki_settings.py` (+ new e2e spec)

## Verification

1. `bench --site wiki.localhost migrate`; `yarn build` in `frontend/`.
2. As Administrator at `wiki.localhost/wiki` → Sidebar menu → **Settings**; dialog
   opens with all four tabs.
3. Toggle "Enable Table of Contents", reload, re-open — persisted. Confirm in Desk
   (`/app/wiki-settings`) to prove single-source.
4. Feedback tab: enabling feedback reveals the submission-limit field; save and
   verify the widget appears on a public page.
5. Header/Robots: set `head_html`, save (dirty badge clears), confirm it lands in
   a rendered public wiki page `<head>`.
6. GitHub App: secrets show as "configured" without revealing values; "Create
   GitHub App" opens the manifest flow and returns to the SPA settings dialog.
7. As a non-manager → Settings item absent.
8. `test_wiki_settings` and the Playwright spec both green.
