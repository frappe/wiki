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

### TB2 — Edit on GitHub

Thin add-on over TB1's fields. In the page header / three-dots menu of `frontend/src/components/WikiDocumentPanel.vue` (shown only when `space.git_synced` and the doc has a `source_path`), an action opening the source file in GitHub's editor in a new tab:

```
https://github.com/{repo_full_name}/edit/{branch}/{source_path}
```

Group landing pages point at their `README.md`/`index.md`. Built purely from existing fields — no new API. GitHub's editor handles the upstream flow (commit to branch, or fork + PR for users without write access), and the change flows back into the wiki on the next sync — keeping us strictly one-way on our side.

- **Tests / demo:** unit for URL construction (incl. group landing, nested paths); browser (agent-browser) asserts the menu item appears on a synced page and links to the right URL.

### TB3 — `.wiki.json` structure override

Let a repo control nav order & titles instead of alphabetical inference. In the engine, if `.wiki.json` exists at repo root, parse `docs_dir` + `nav` (ordered, possibly nested) and drive `parent_wiki_document` chain + `sort_order` + titles from it; absent → TB1 inference unchanged.

```json
{ "docs_dir": "docs", "title": "My Docs",
  "nav": [ {"Intro": "intro.md"}, {"Guides": [{"Setup": "guides/setup.md"}]} ] }
```

- **Tests / demo:** unit for config parse + ordering/nesting and the inference fallback; browser (agent-browser) syncs a repo with `.wiki.json` and asserts sidebar order/titles.

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

- [ ] TB1 — Walking skeleton: read-only synced space from a public repo (manual sync)
- [ ] TB2 — Edit on GitHub
- [ ] TB3 — `.wiki.json` structure override
- [ ] TB4 — GitHub App connection + repo picker (private repos)
- [ ] TB5 — Sync log & status panel
- [ ] TB6 — Real-time webhook sync
