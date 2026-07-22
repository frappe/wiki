# Spec loop — one tracer bullet per iteration

You are working in the **Frappe Wiki** app. Read and obey `CLAUDE.md` at the repo root — its
Implementation Guidelines, Regression tests, and Pull Requests sections are authoritative. Always
load and use the **frappe-app-dev** skill (and **code-style** when writing code).

## CONTEXT (passed in at the top of your prompt)

- The single spec file to work on, the current branch, and recent commits. You are **already on the
  correct branch** — do NOT create or switch branches.

## SOURCE OF TRUTH = THE SPEC'S PROGRESS SECTION

The spec ends with a `## Progress` section: a checklist of its tracer bullets. This — not git
history — is how you know what is done.

1. Read the whole spec.
2. In `## Progress`, find the **first unchecked** tracer bullet (`- [ ] TBn …`). Bullets are ordered
   so each builds on the previous — never skip ahead.
3. That is your task for this iteration.

If every bullet in `## Progress` is checked: output `<promise>COMPLETE</promise>`, push, and stop.

## ONE BULLET PER ITERATION

Work on **exactly ONE tracer bullet.** A tracer bullet is already the smallest end-to-end slice; do
not split it across iterations, and do not bundle two.

If the chosen bullet turns out larger than the spec implies (e.g. it needs a refactor first), output
`HANG ON A SECOND`, carve off the smallest prerequisite chunk, do only that, and record the split in
`## Progress`. Don't outrun your headlights.

## EXPLORATION

Explore first — the doctypes, controllers, frontend components, and helpers named in the spec's
"Existing code to REUSE" section. Reuse before writing new code.

## EXECUTION

Implement the bullet end-to-end through every layer it touches (doctype → engine/API → frontend),
following the spec's per-bullet detail. After touching anything under `frontend/src/**`, run the
build from `frontend/` (`yarn build`) — do not wait to be asked.

## FEEDBACK LOOPS (before committing)

- Unit tests for the bullet's backend logic: `bench --site wiki.localhost run-tests --app wiki`
  (scope to the new module/test where possible). When fixing a bug, temp-revert the fix first to
  confirm the test fails, then restore it (per CLAUDE.md).
- Browser check with the **agent-browser** skill against `wiki.localhost`
  (Administrator / admin). NEVER launch chromium directly. Capture a screenshot of the working
  slice.

## RECONCILE THE SPEC

Two updates to the same spec file, committed with the code:

1. Add a short **as-built** note to the bullet's `### TBn` section (what shipped, any deviation).
2. In `## Progress`, tick the bullet: `- [x] TBn — <one-line outcome>`.

## COMMIT

One **proper conventional commit** (no special prefix or tag). Examples:
`feat(git-sync): add Wiki Space git_synced flag and read-only enforcement (TB1)` or
`feat(git-sync): edit-on-github action on synced pages (TB2)`.
Body: key decisions, files changed summary, and any note for the next iteration. Reference the spec
+ bullet. Keep it concise. Commit only on the current branch — never create a branch.

## PULL REQUEST (CLAUDE.md convention)

A **single** PR for this branch against `develop`. Keep the description **stupid simple**, using the
feature format `## Why?` `## What?` `## How?`, and reference the spec.

**Use these exact commands. Do NOT use `gh pr edit` — it fails on a deprecated Projects GraphQL
field. Update the body via the REST API instead.**

```bash
# Resolve repo + check whether a PR already exists for the current branch
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BRANCH=$(git branch --show-current)
PR=$(gh pr list --head "$BRANCH" --json number -q '.[0].number')

# Write the body to a file (Why/What/How + Progress checklist mirror)
cat > /tmp/pr-body.md <<'EOF'
## Why?
...
## What?
...
## How?
...
EOF

if [ -z "$PR" ]; then
  # First time: create the PR (gh pr create is fine)
  gh pr create --base develop --head "$BRANCH" \
    --title "feat(git-sync): one-way GitHub → Wiki sync" \
    --body-file /tmp/pr-body.md
else
  # PR exists: update the body via REST (NOT gh pr edit)
  gh api -X PATCH "repos/$REPO/pulls/$PR" -F body=@/tmp/pr-body.md
fi
```

After the first bullet the PR exists, so every later iteration just pushes and runs the REST
`PATCH` to refresh the body's `## Progress` checklist. `gh pr create`, `gh pr list`, and `gh pr view`
are safe; only `gh pr edit` is broken.

## NOTIFY

Send a Telegram message via `bwh_bot` (see `bwh_bot --help`) summarizing the bullet shipped, with
the agent-browser screenshot(s) attached. Then push.

## FINAL RULES

- ONE tracer bullet per iteration. Never create or switch branches.
- Reuse existing helpers; match surrounding code style.
- If blocked, leave the bullet unchecked in `## Progress`, record the blocker in the commit/PR, and
  stop.
