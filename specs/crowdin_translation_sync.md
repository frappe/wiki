# Crowdin Translation Sync for Frappe Wiki

Date: 2026-07-07
Status: **Planned.** Not yet started. Replicates the existing, working setup in `apps/lms` verbatim, adapted for the `wiki` app. Addresses issue [#441](https://github.com/frappe/wiki/issues/441) ("Add wiki to translation on Crowdin").

## Goal

Enable community translations for Frappe Wiki via Crowdin. Translatable strings flow **repo → Crowdin** as a source POT, and **Crowdin → repo** as per-language `.po` files delivered by automated PRs. Wiki has **none** of this today (no `crowdin.yml`, no `wiki/locale/`, no POT-generation workflow); LMS already runs it in production, so we copy that setup exactly.

## How the setup works (the LMS model we copy)

Two moving parts:

1. **Repo → Crowdin (source of truth for strings):** a scheduled GitHub Action regenerates `<app>/locale/main.pot` — every translatable string extracted from `.py/.js/.vue/.html` via `bench generate-pot-file` — and opens a PR. Crowdin reads that POT as its source file.
2. **Crowdin → Repo (translations):** Crowdin's **GitHub integration app** — configured on crowdin.com, **not** in the repo (this is why `grep -ri crowdin .github/` finds nothing in LMS) — reads `crowdin.yml`, pushes each `<lang>.po` back into `wiki/locale/`, and opens sync PRs styled by the `pull_request_title` / `pull_request_labels` / `commit_message` keys in `crowdin.yml`.

## Current State (wiki)

- App name `wiki`, title `Wiki` (`wiki/hooks.py`); Python `>=3.14` (`pyproject.toml`); has `frontend/src` (frappe-ui / Vue).
- Workflows present: `ci.yml`, `linters.yml`, `ui-tests.yml`. **No** `generate-pot-file.yml`, **no** `.github/helper/` dir.
- **No** `crowdin.yml`, **no** `wiki/locale/`, **no** `*.pot`.
- Frappe provides the `generate-pot-file` command (`apps/frappe/frappe/commands/gettext.py`) — extraction works out of the box.
- `frappe/wiki` upstream has both `develop` and `master`; convention (CLAUDE.md) is target **`develop`**.

## Reference files in LMS (exact sources to copy)

- `apps/lms/crowdin.yml`
- `apps/lms/.github/workflows/generate-pot-file.yml`
- `apps/lms/.github/helper/update_pot_file.sh`
- `apps/lms/lms/locale/main.pot` + 34 `<lang>.po` files (the output shape, generated — not hand-authored)

---

## Repo-side plan (what code produces)

### 1. `crowdin.yml` (repo root) — copy of LMS, paths `lms`→`wiki`

```yaml
files:
  - source: /wiki/locale/main.pot
    translation: /wiki/locale/%two_letters_code%.po
pull_request_title: "chore: sync translations from crowdin"
pull_request_labels:
  - translation
commit_message: "chore: %language% translations"
append_commit_message: false
```

### 2. `.github/workflows/generate-pot-file.yml` — copy of LMS verbatim

App-agnostic; no edits needed. Keep: cron `00 16 * * 5` (Fri 16:00 UTC) + `workflow_dispatch`, matrix branch `develop`, Python `3.14`, Node `24`, `permissions: contents: write`, runs `.github/helper/update_pot_file.sh` with env `GH_TOKEN: ${{ secrets.RELEASE_TOKEN }}` and `BASE_BRANCH: ${{ matrix.branch }}`.

### 3. `.github/helper/update_pot_file.sh` — copy of LMS, `lms`→`wiki`

Create `.github/helper/` (does not exist yet). Substitute every app reference:

- `bench get-app --skip-assets wiki "${GITHUB_WORKSPACE}"`
- `bench generate-pot-file --app wiki`
- `cd ./apps/wiki`
- `git add wiki/locale/main.pot`
- `git remote set-url upstream https://github.com/frappe/wiki.git`
- `gh pr create --fill --base "${BASE_BRANCH}" --head "${branch_name}" -R frappe/wiki`
- Bot identity kept identical to LMS: `frappe-pr-bot` / `developers@erpnext.com`.

### 4. Seed `wiki/locale/main.pot`

Run `bench generate-pot-file --app wiki` locally to create `wiki/locale/main.pot`; commit it. Crowdin needs a source POT to exist on first sync. (`.po` files are **not** hand-created — Crowdin generates them.)

## External / admin steps (outside the repo — flag to a frappe-org maintainer)

Cannot be done from the codebase; live on crowdin.com + GitHub repo settings:

1. Create a **Crowdin project** for wiki under the frappe org; add target languages.
2. Authorize the **Crowdin GitHub app** on `frappe/wiki`; point its integration at branch `develop`. Crowdin then honors `crowdin.yml`.
3. Create the **`translation`** GitHub label in `frappe/wiki` (Crowdin's `pull_request_labels` needs it to exist).
4. Ensure repo secret **`RELEASE_TOKEN`** exists (the POT workflow pushes a branch + opens a PR with it). Wiki has no other workflow using it today, so a maintainer likely must add it.

## Branch / PR

Branch `feat/crowdin-translation-sync` off `upstream/develop`; PR to `frappe/wiki` `develop`. Translation `.po` files land later automatically via Crowdin, not in this PR.

## Verification

- **Local:** `bench generate-pot-file --app wiki` → `wiki/locale/main.pot` created and non-empty (contains `msgid` entries from wiki source). Confirms extraction before committing.
- **Workflow:** after merge, trigger `generate-pot-file.yml` via `workflow_dispatch` → confirms it opens an "update POT file" PR (needs `RELEASE_TOKEN`).
- **Crowdin (admin):** once the Crowdin project + GitHub integration are live, a manual sync should open a `chore: sync translations from crowdin` PR labeled `translation` — proves the round-trip.
