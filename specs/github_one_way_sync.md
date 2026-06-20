# GitHub One-Way Sync for Wiki Spaces

Date: 2026-06-20
Status: **Planned.** Not yet started. Inspired by the `BuildWithHussain/giki` POC, scoped down to **one-way** (repo → wiki) only.

## Goal

Let a Wiki Space be marked **Git synced** so its content lives in a **GitHub repository** and flows **one way** (repo → wiki). A git-synced space is **read-only** in the wiki — no editing, creating, renaming, moving, or deleting pages from this side — and the repo is the single source of truth. Users browse the synced structure in the sidebar and read pages normally.

Settled scope:

- **One-way only.** Repo → wiki. No write-back / PR creation (the POC did 2-way; we explicitly do **not** want that yet).
- **Structure** is inferred from the repo's docs folder by default (`.md` → page, folder → group, `README.md`/`index.md` → group landing); an optional `.wiki.json` at repo root overrides nav order & titles.
- **GitHub access** uses a **GitHub App** (the giki/press model): the user connects their GitHub account, the app lists their installations & repositories, they pick one. Installation tokens are minted on demand from the App private key — **private repos work for free**, no long-lived secrets stored per space.
- **Triggers:** manual "Sync now" + a signed GitHub **webhook** for real-time push sync. A scheduler poller is a deferred fast-follow.
- **"Edit on GitHub"** action on every synced page that opens the page's source file in GitHub's editor.

## Current State

- Every wiki edit funnels through a **Change Request** (local-first): opening a space auto-creates a draft CR and all mutations flush via `apply_cr_operations`. Nothing writes `Wiki Document` directly. → Read-only mode reduces to **blocking CR creation**.
- The wiki already has a **Git-like internal engine** we reuse rather than reinvent: `Wiki Revision` (commit chain + tree/content hashes), `Wiki Revision Item`, `Wiki Content Blob` (SHA-256 dedup), `Wiki Change Request`, `Wiki Merge Conflict`, plus a three-way / fast-forward merge applier.
- A `Wiki Space` auto-creates a `root_group` `Wiki Document` (`is_group=1`) on `before_insert` (`wiki_space.py:49`); the space's content is the NestedSet subtree under it. `Wiki Document.content` is **Markdown**; `doc_key` (`wiki_document.py:115`) is the immutable internal identity.
- `Wiki Settings` is a singleton (`wiki/wiki/doctype/wiki_settings/wiki_settings.json`) — extendable to host the GitHub App credentials.
- No per-space editability flag exists yet; `scheduler_events` in `hooks.py` are all commented out (lines 126-148).
- No Git/GitHub functionality exists today.

## Existing code to REUSE (do not reinvent)

- `create_revision_from_live_tree(space, ...)` — `wiki/frappe_wiki/doctype/wiki_revision/wiki_revision.py:19` — snapshot live tree.
- `get_or_create_content_blob(...)` — `wiki_revision.py:183` — SHA-256 content dedup.
- `get_revision_item_map(...)` — `wiki_revision.py:262`.
- `_apply_merge_changes_only(space, merge_revision, prev_items)` — `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py:1816` — idempotently applies a target revision (creates/updates/deletes/moves, content fast-path, reparent-before-delete, `sort_order` reconcile, sets `main_revision`). **This is the sync write path.**
- `frappe.flags.in_apply_merge_revision` — already suppresses `Wiki Document.on_update` revision side-effects (`wiki_document.py:672`). Set it around the apply.
- GitHub App plumbing pattern from the POC: `giki/api/github.py` (`installations`, `repositories`), `giki/www/github/{authorize,redirect}.py` (OAuth + app-manifest flow), originally from frappe/press.

---

## Tracer-bullet plan

Each bullet is a **thin vertical slice through every layer** (doctype → engine/API → frontend → test) that ends in something demoable, so we validate the architecture early and cheaply. They ship in order; later bullets thicken the slice without re-architecting earlier ones.

**Ordering rationale.** The single biggest architectural risk is whether the existing merge applier (`_apply_merge_changes_only`) can be driven by a **target revision synthesized outside a Change Request**. TB1 proves exactly that, using an **unauthenticated public repo** to skip the GitHub App lift entirely — the engine is written to take an *optional* token, so swapping in real auth later (TB4) touches only the token source, not the engine. Auth is deferred because it's low-risk (mechanically copied from the POC/press), not because it's unimportant.

Commit this spec first (per CLAUDE.md) on branch `feat/git-sync` off `develop`, then one commit per bullet.

**Testing convention.** Every bullet ships unit tests for its backend logic. Browser-level checks are driven with the **`agent-browser` skill** (or the committed **Playwright** e2e suite) against `wiki.localhost` — never ad-hoc chromium scripts. Per CLAUDE.md, temp-revert each fix to confirm the test fails first.

---

### TB1 — Walking skeleton: read-only synced space from a public repo (manual sync)

The end-to-end skeleton. Mark a space git-synced, point it at a **public** repo + branch via plain text inputs, click **Sync now**, and browse the inferred tree read-only. No GitHub App, no `.wiki.json`, no picker yet.

- **Data** — on `Wiki Space` (`wiki/wiki/doctype/wiki_space/wiki_space.json`, new "Git Sync" tab, all `read_only` in desk): `git_synced` (Check, **immutable after insert** — enforce in `validate`), `repo_full_name`, `branch`, `docs_subdir`, `last_synced_commit_sha`, `last_sync_status` (Select Pending/Running/Success/Error), `last_sync_time`, `last_sync_error`. On `Wiki Document` (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.json`): `source_path` (Data, read_only) — repo-relative path; cross-sync identity = `(wiki_space, source_path)`, `doc_key` stays internal. `before_insert` still calls `create_root_group()` unchanged.
- **Engine** — new `wiki/wiki/git_sync.py`, run via `frappe.enqueue(queue="long")`, takes an **optional** `token`:
  1. Head SHA via `GET /repos/{repo}/git/ref/heads/{branch}`; if `== last_synced_commit_sha` → no-op exit.
  2. `GET /repos/{repo}/git/trees/{branch}?recursive=1` → all paths + blob SHAs in one call; filter to `docs_subdir` + `*.md`/`*.mdx` (+ folders).
  3. **Infer** structure: folder → `is_group`, `.md` → leaf, `README.md`/`index.md` → group landing, title from first H1 else filename, `sort_order` alphabetical.
  4. Snapshot live tree via `create_revision_from_live_tree` → `prev_items = get_revision_item_map(...)`; build target Wiki Revision Items (reuse `doc_key` for matched `source_path`, else new; bodies via `get_or_create_content_blob`; fetch blob contents only for changed SHAs).
  5. `frappe.flags.in_apply_merge_revision = True`; `_apply_merge_changes_only(space, target_revision, prev_items)` under `ignore_permissions`; stamp `source_path`; update SHA/status/time.
- **Trigger** — whitelisted `Wiki Space.sync_now()` enqueuing the engine.
- **Read-only enforcement (defense in depth)** —
  - *Backend:* `frappe.throw` if `space.git_synced` in `get_or_create_draft_change_request` (`wiki_change_request.py:461`), `create_change_request` (`:787`), `apply_cr_operations` (`:1004`), `reorder_wiki_documents` (`wiki/api/wiki_space.py:90`); and deny write ptypes in `wiki_document_has_permission` (`wiki/permissions.py:163`) **except** when `in_apply_merge_revision` is set.
  - *Frontend (thread `space.doc.git_synced` from `SpaceDetails.vue`):* skip `initChangeRequest`, hide `ContributionBanner` (lines 74-79), show a "Git synced — read only" badge + repo link + "Sync now"; `WikiEditor.vue` `new Editor` (`:555`) `editable: false` + hide toolbar/slash + short-circuit save; disable drag/create/rename/delete in `WikiDocumentList.vue` / `NestedDraggable.vue` / `useTreeDialogs.js`.
- **Create-space** — in `SpaceList.vue` create dialog (`:72-107`, submit `:220-233`): a "Git synced" switch revealing `repo_full_name` + `branch` inputs; pass them in the insert payload; kick off `sync_now` after creation.
- **Tests / demo** — unit (mock GitHub HTTP): build-target-from-tree, `source_path`/`doc_key` stability across re-sync, add/update/delete/move classification, idempotent no-op sync. Browser (agent-browser skill): create a synced space against a small public docs repo, browse the tree, assert editor non-editable + no mutation affordances + no `ContributionBanner`, assert "Sync now" reflects a repo change.

**Why first:** validates the riskiest seam (external-driven merge apply) + the entire read-only model with zero auth investment.

**Split (spec-loop):** TB1 was carved into two iterations because it spans far more than one demoable slice.

- **TB1a — backend skeleton (DONE).** Data fields + sync engine + `sync_now` trigger + unit tests. The riskiest seam, demoable via console/portal.
  - *As built:* Added a "Git Sync" tab to `Wiki Space` (`git_synced` immutable-after-insert + read-only desk fields: `repo_full_name`, `branch`, `docs_subdir`, `last_sync_status`, `last_synced_commit_sha`, `last_sync_time`, `last_sync_error`) and a read-only `source_path` to `Wiki Document`. New engine `wiki/wiki/git_sync.py`: module-level `_fetch_head_sha`/`_fetch_tree`/`_fetch_blob` (monkeypatched in tests), `build_nodes()` structure inference (folder→group, `.md`→leaf, `README.md`/`index.md`→folder landing, repo-root landing→root group, H1-or-humanized title, alphabetical `sort_order`), and `_sync_to_live()` which snapshots the live tree, synthesizes a **target Wiki Revision** keyed by `doc_key` (reused per `source_path`), and drives the existing `_apply_merge_changes_only` under `frappe.flags.in_apply_merge_revision`, then stamps `source_path` back onto live docs. Head-SHA short-circuit gives idempotent no-op syncs. `Wiki Space.sync_now()` enqueues `wiki.wiki.git_sync.sync_space` on the `long` queue. 9 unit tests (mock GitHub HTTP) cover inference, add/update/delete/path-change, `source_path`/`doc_key` stability, no-op, immutability. Demoed live against the public `BuildWithHussain/giki` repo → read-only tree rendered in the SPA.
  - *Deviations / notes for next iter:* (1) Identity is strictly `(wiki_space, source_path)`, so a file **path change is a delete+add**, not a tree move (intentional). (2) Blob contents are fetched for every `.md` (the "only changed SHAs" optimization is deferred — needs per-file git-blob-sha persistence). (3) On engine exception the error is recorded to `last_sync_error` and swallowed (no re-raise / partial-apply rollback yet) — TB5 hardens this with the sync log. (4) Engine fields are settable on insert via API even though desk-read-only; TB1b's create dialog supplies them.
- **TB1b — read-only enforcement + create-space UI.** Carved into two iterations because it bundles three independent slices (backend enforcement, a new non-CR read-only render path, and the create dialog) — far more than one demoable slice. The authoring SPA sources its sidebar tree *from a Change Request* (`transport.fetchTree(crName)`), so rendering a synced space read-only needs a brand-new non-CR tree path, not just toggling flags.
  - **TB1b-i — backend read-only enforcement (DONE).** Shared helpers in `wiki/permissions.py`: `is_git_synced_space(space)` (cached `git_synced` lookup) and `assert_space_writable(space)` (throws `PermissionError` unless `frappe.flags.in_apply_merge_revision` — the sync engine's bypass). Wired into the four CR/reorder entry points: `get_or_create_draft_change_request`, `create_change_request`, `apply_cr_operations` (via `cr.wiki_space`), and `reorder_wiki_documents` (via `_get_wiki_space_for_document`). `wiki_document_has_permission` now denies write ptypes on a synced space's documents except under the merge flag (defense in depth — blocks desk + any path the four entry points miss). 6 unit tests in `TestGitSyncReadOnly`; each fails when the fix is temp-reverted. *Note:* the read path (public reader → `get_wiki_tree`) never creates a CR, so synced-space browsing/reading is unaffected; only the manager authoring console (which auto-creates a CR) now refuses to bootstrap one for a synced space — TB1b-ii replaces that with a read-only render.
  - **TB1b-ii — frontend read-only + create-space dialog (DONE).** Thread `space.doc.git_synced`; replace the CR-sourced sidebar tree with a non-CR read-only tree (`get_wiki_tree`); skip `initChangeRequest`; hide `ContributionBanner`; "Git synced — read only" badge + repo link + "Sync now" button; `WikiEditor.vue` `editable:false` + hidden toolbar/slash + short-circuit save; disable drag/create/rename/delete in `WikiDocumentList.vue`/`NestedDraggable.vue`/`useTreeDialogs.js`; create-space "Git synced" switch in `SpaceList.vue`. The still-editable editor + CR draft banner observed in the TB1a demo are exactly what this removes.
    - *As built:* `SpaceDetails.vue` computes `isGitSynced` from the space doc and branches the whole render path: the CR-hydrate watch early-returns for synced spaces, a second watch loads a read-only tree from `get_wiki_tree` (adapted from its `name`-keyed shape into the snake_case shape the tree components consume — Wiki Document `name` doubles as `doc_key`/`document_name`, no CR overlay needed) and auto-kicks the first sync for a never-synced space (guarded on empty `last_sync_time`). `ContributionBanner` is replaced by an inline synced bar (GitHub icon, "Git synced — read only", `last_sync_status` badge, `repo@branch` link, "Sync now" → `sync_now` doc method). `readonly` is threaded as a prop through `WikiDocumentList` (hides create buttons + empty-state CTA) → `NestedDraggable` (`:disabled` drag, hides handle/dropdown/empty-group add buttons, recursively) and to `WikiDocumentPanel` via the router-view (skips CR load, renders from `wikiDoc.doc.content`, hides Save/title-edit/route-edit/publish, `editorKey` gates on the doc not a CR overlay) → `WikiEditor` (`editable:false`, no toolbar/bubble menu, save/autosave/⌘S short-circuited). `SpaceList.vue` create dialog gained a "Git synced" checkbox revealing `repo_full_name` + `branch`, passed in the insert payload (engine fields are API-settable). New e2e `e2e/tests/git-sync-readonly.spec.ts` seeds a synced space + page via API and asserts the banner, hidden affordances, and non-editable viewer; temp-reverting `editable:!readonly` makes it fail (verified). Demoed live against the existing `BuildWithHussain/giki` synced space.
    - *Deviations / notes:* (1) The synced banner is inlined in `SpaceDetails` rather than a dedicated component — TB5's `GitSyncPanel.vue` will own the richer status surface. (2) "Sync now" enqueues on the long queue and optimistically reloads the tree after ~4s (no live progress yet — TB5). (3) The router-view passes `:readonly` to all space child routes; only `WikiDocumentPanel` declares it (`SpaceWelcome`/`DraftContributionPanel` ignore it — the latter is unreachable for synced spaces). (4) External-link rows are never produced for synced trees, so the adapter hard-codes `is_external_link:false`.

### TB2 — Edit on GitHub

Thin add-on over TB1's fields. In the page header / three-dots menu of `frontend/src/components/WikiDocumentPanel.vue` (shown only when `space.git_synced` and the doc has a `source_path`), an action opening the source file in GitHub's editor in a new tab:

```
https://github.com/{repo_full_name}/edit/{branch}/{source_path}
```

Group landing pages point at their `README.md`/`index.md`. Built purely from existing fields — no new API. GitHub's editor handles the upstream flow (commit to branch, or fork + PR for users without write access), and the change flows back into the wiki on the next sync — keeping us strictly one-way on our side.

- **Tests / demo:** unit for URL construction (incl. group landing, nested paths); browser (agent-browser) asserts the menu item appears on a synced page and links to the right URL.

*As built:* New pure helper `frontend/src/lib/github.js` — `buildGithubEditUrl({repoFullName, branch, sourcePath})` (returns `null` unless `sourcePath` ends in `.md`/`.mdx`) + `isEditableSourcePath`. `WikiDocumentPanel.vue` computes `githubEditUrl` from the cached `Wiki Space` resource (`getCachedDocumentResource`, the same one `SpaceDetails` loaded) + the open doc's `source_path`, and pushes an **"Edit on GitHub"** item (GitHub icon, opens `https://github.com/{repo}/edit/{branch}/{source_path}` in a new tab) into `menuOptions` whenever the URL resolves. The three-dots `Dropdown` trigger gained `:title="More actions"` for a stable a11y/e2e handle (mirrors `ContributionBanner`/`ContributionReview`). **Engine deviation reconciled:** TB1a stamped a group's `source_path` as its *folder* path, but the spec's URL plugs `source_path` straight in and wants group landings to point at their `README.md`/`index.md`. So `build_nodes` now stamps a group's `source_path` as its landing file when one exists (folder path only when there's no landing → no editable source → item hidden). Backend unit `test_group_landing_source_path_points_at_readme` + updated `test_build_nodes_classifies_folders_files_and_landings` (temp-revert verified both fail). New e2e `e2e/tests/git-sync-edit-on-github.spec.ts` seeds a synced space + nested-path page, opens the menu, stubs `window.open`, and asserts the exact URL. Demoed live on `BuildWithHussain/giki` → `https://github.com/BuildWithHussain/giki/edit/main/giki/github_integration_README.md`.

*Deviations / notes:* (1) The root group / repo-root landing never renders as a page panel, so it gets no "Edit on GitHub" (intentional — it's the space container). (2) Changing a group's `source_path` to its landing path is a one-time re-sync churn for pre-existing synced spaces (the group's old folder-path identity → delete+add via the merge applier's reparent-before-delete); harmless for the beta. (3) No JS unit runner exists (no vitest), so "URL construction" is covered by the backend `source_path` unit tests (group landing) + the e2e exact-URL assertion (nested path).

### TB3 — `.wiki.json` structure override

Let a repo control nav order & titles instead of alphabetical inference. In the engine, if `.wiki.json` exists at repo root, parse `docs_dir` + `nav` (ordered, possibly nested) and drive `parent_wiki_document` chain + `sort_order` + titles from it; absent → TB1 inference unchanged.

```json
{ "docs_dir": "docs", "title": "My Docs",
  "nav": [ {"Intro": "intro.md"}, {"Guides": [{"Setup": "guides/setup.md"}]} ] }
```

- **Tests / demo:** unit for config parse + ordering/nesting and the inference fallback; browser (agent-browser) syncs a repo with `.wiki.json` and asserts sidebar order/titles.

*As built:* Engine-only addition in `wiki/wiki/git_sync.py`. `load_wiki_config(repo, tree, token)` finds `.wiki.json` at the repo root in the already-fetched tree, fetches+parses it, and **raises** on malformed JSON / non-object (surfaced via the sync error rather than silently falling back). `build_nodes_from_config(repo, tree, config, docs_subdir, token)` walks the ordered `nav` (single-key dicts: `{"Title": "path.md"}` → leaf, `{"Title": [children]}` → group), resolving leaf paths under `config.docs_dir` (falls back to the space's `docs_subdir`). It emits the **same node shape** as `build_nodes`, so `_sync_to_live` needs zero changes: hierarchy rides on synthetic `dir`/`parent_dir` keys (the nav title-chain), and nav order rides on a zero-padded monotonic `seg` counter that the existing alphabetical sibling-sort reproduces as document order. Titles come straight from `nav` (overriding H1/humanize). `sync_space` calls `build_nodes_from_config` when `.wiki.json` carries a `nav`, else the TB1 inference path unchanged. 7 unit tests (parse present/absent/malformed, order+titles+nesting, missing-file skip, `docs_dir` override, plus a full sync-to-live test asserting live `sort_order`/titles/parenting with a deliberately non-alphabetical nav); the sync-level test is temp-revert verified.

*Deviations / notes:* (1) `nav` is treated as **authoritative** — only files it lists are synced; repo files absent from `nav` are ignored, and a nav entry whose file is missing from the tree is skipped (no empty page). (2) A nav **group** is file-less: its identity is the synthetic `\.wiki.json#<title-chain>` source_path (stable while the title-chain is stable), so it carries **no** "Edit on GitHub" link and no landing content (group landings under nav are a possible later enhancement; folder-inference groups still get their README/index landing). (3) `config.docs_dir` overrides the space's `docs_subdir` for path resolution when present. (4) Browser demo deferred — the live `BuildWithHussain/giki` repo has no `.wiki.json` and creating/pushing to an external repo is out of scope here; the config path is covered by the unit suite end-to-end through the live tree.

### TB4 — GitHub App connection + repo picker (private repos)

Swap the token source from "none/public" to a real GitHub App, unlocking private repos and the connect-and-pick UX the user wants.

- **Settings** — extend the `Wiki Settings` singleton with a "GitHub App" tab: `github_app_id`, `github_app_client_id`, `github_app_client_secret` (Password), `github_app_private_key` (Password/Code), `github_webhook_secret` (Password), `github_app_public_link`. Optionally support the app-manifest auto-creation flow (POC `redirect.py`); else admin pastes manually-created App credentials.
- **Auth** — `wiki/api/github.py`: `installations(token)`, `repositories(installation, token)`, and an **installation-token minter** (JWT from `github_app_id` + `github_app_private_key` → `POST /app/installations/{id}/access_tokens`; short-lived, mint on demand, never store). OAuth round-trip via `wiki/www/github/{authorize,redirect}.py` (adapt POC; store user/installation linkage).
- **Data** — add `github_installation_id` to `Wiki Space`; engine now mints a token from it and passes it through every REST call (private repos work).
- **Frontend** — "Connect GitHub" action + a repo picker (installation → repo → branch, defaulting `branch` from `default_branch`) replacing TB1's plain text inputs in the create-space flow.
- **Tests / demo:** unit for token minting (mocked) + installation/repo listing; browser (agent-browser, mocked App) connects, picks a private repo, syncs.

### TB5 — Sync log & status panel

Make sync observable. New doctype `Wiki Git Sync Log` (`wiki_space`, `status`, `commit_sha`, `started_at`, `finished_at`, `created_count`, `updated_count`, `deleted_count`, `moved_count`, `log` Code, `error`), written by the engine each run. New `frontend/src/components/SpaceSettings/GitSyncPanel.vue` (mirrors `GeneralPanel.vue:102-126`) showing repo/branch/last-sync, a "Sync now" button, and the run history.

- **Tests / demo:** unit asserts a log row with correct counts per sync; browser (agent-browser) opens the panel, triggers a sync, sees the new log entry.

### TB6 — Real-time webhook sync

Push-driven sync so users don't click. Whitelisted `allow_guest` `wiki.api.github.webhook` (registered in `website_route_rules`, `wiki/hooks.py`): verify `X-Hub-Signature-256` (HMAC-SHA256) against `github_webhook_secret`, reject on mismatch; handle `push` only — match `repository.full_name` + `ref` to git-synced `Wiki Space`(s) and `enqueue(queue="long")` `git_sync.sync_space` for each; ignore other events. Auto-configured by the App install (no per-repo manual setup); surface delivery status in `GitSyncPanel.vue`.

- **Tests / demo:** unit for signature verification (valid/invalid/missing), branch-match routing, non-push ignored; browser (agent-browser): push to the repo → wiki updates without a click.

## Verification (whole feature, after the bullets land)

1. `bench build` after frontend edits (rebuild from `frontend/`).
2. Configure the GitHub App (TB4) in Wiki Settings; connect account; create a space pointed at a small docs repo (`docs/` with nested `.md` + a `.wiki.json`).
3. Confirm the sidebar shows the configured tree, pages render, and the editor + all mutation affordances are absent/disabled; confirm desk-side write is also blocked; confirm "Edit on GitHub" opens the right file.
4. Push a change → confirm the webhook (TB6) syncs it automatically; also test "Sync now". Confirm a `Wiki Git Sync Log` row records counts; re-run with no repo change → no-op (SHA short-circuit).
5. Run unit + browser (agent-browser / Playwright) suites.

## Deferred / out of scope

- 2-way sync / PR write-back (the POC's other half) — explicitly not wanted now.
- Scheduler poller (cron fallback) — fast follow; the webhook (TB6) covers real-time sync.
- Repo image/asset import into Frappe Files (v1: leave relative/external URLs as-is) — revisit.
- GitHub App auto-creation via manifest flow is optional; manual App credentials are acceptable for v1.

## Progress

The spec-loop's source of truth. Tick a bullet (`- [x]`) when it ships, with a one-line outcome.

- [x] TB1a — Backend skeleton: Git Sync fields + `git_sync.py` engine + `sync_now`; synced read-only tree from public repo, 9 unit tests, demoed on `BuildWithHussain/giki`.
- [x] TB1b-i — Backend read-only enforcement: `assert_space_writable`/`is_git_synced_space` helpers wired into the 4 CR/reorder entry points + `wiki_document_has_permission` write-deny; 6 unit tests (temp-revert verified).
- [x] TB1b-ii — Frontend read-only: `isGitSynced` render path in SpaceDetails (non-CR `get_wiki_tree`, synced banner + repo link + Sync now), `readonly` threaded through list/tree/panel/editor, create-space "Git synced" dialog; e2e spec (temp-revert verified).
- [x] TB2 — Edit on GitHub: `buildGithubEditUrl` helper + "Edit on GitHub" menu item in `WikiDocumentPanel`; group `source_path` now points at its README/index landing; backend unit tests + e2e (temp-revert verified), demoed on `BuildWithHussain/giki`.
- [x] TB3 — `.wiki.json` structure override: `load_wiki_config` + `build_nodes_from_config` drive nav order/nesting/titles (same node shape → zero `_sync_to_live` changes); inference fallback intact; 7 unit tests (temp-revert verified).
- [ ] TB4 — GitHub App connection + repo picker (private repos)
- [ ] TB5 — Sync log & status panel
- [ ] TB6 — Real-time webhook sync
