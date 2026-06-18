# Change Request Review Flow — Revamp

Date: 2026-06-18
Status: **Draft / proposed.** Not yet implemented. Supersedes the half-built reviewer/participant model in `Wiki Change Request`.

## Goal

Make the **submit → review → approve / request changes / reject → merge** flow polished, honest, and stable. Today the doctype models a rich multi-reviewer system but the UI wires up almost none of it; the result is dead scaffolding and several correctness holes (see [Audit](#audit-what-is-broken-today)). We pick the **minimal-but-complete** model:

- **Reviewer assignment uses Frappe's native assignment** (`_assign` / ToDo). No custom reviewer table. Assignment Rules, manual assign, and the "assigned to me" surface all come for free from the framework.
- **Three reviewer decisions:** Approve, Request Changes, Reject.
  - **Approve** → status `Approved`. Does **not** publish; **Merge is a separate explicit action**.
  - **Request Changes** (comment required) → `Changes Requested`. Goes back to the author to revise & resubmit.
  - **Reject** (comment required) → `Rejected`. **Terminal** — the CR will not be merged.
- **Reviewers act from a three-dots menu** in the review header.
- **Preview**, not just diffs: a reviewer can preview how the proposed pages will actually render in the docs, not only read a markdown diff.
- We are **not** hardening concurrency for now (no multi-reviewer races, no concurrent-merge guard beyond a simple status check). Single reviewer acting at a time is assumed.

### Settled state machine

```
                  ┌──────── withdraw (author) ────────┐
                  ▼                                    │
Draft ──submit──▶ In Review ──approve──▶ Approved ──merge──▶ Merged
  ▲                  │  │                   ▲
  │           request │  │ reject           └── Approve & Merge (approve + merge, one step)
  │          changes  │  │
  └──────────┐        ▼  ▼
   Changes Requested     Rejected (terminal)
        │  (author edits + resubmits)
        └──submit──▶ In Review …
```

- `Archived` stays as the author's "discard my draft" terminal state (unchanged).
- `Rejected` is a **new** terminal state (reviewer-driven; distinct from author-discarded `Archived`).
- `Open` status is removed (never used).
- **Editing is locked** while a CR is `In Review` / `Approved` / `Merged` / `Rejected`. Only `Draft` and `Changes Requested` are editable.
- **Withdraw:** the author can pull an `In Review` CR back to `Draft` (re-opening it for editing), and from `Draft` may then Discard (→ `Archived`) as today.
- **Merge requires `Approved`.** Two paths:
  - **Approve & Merge** — a one-step action (with an "Are you sure?" confirmation dialog) that approves *and* merges. This is the normal path for a writer/manager merging their **own** CR — no second person required.
  - **Merge** — a plain action available when the CR is already `Approved` (e.g. someone else approved it).

## Audit (what is broken today)

Grounded references for why each phase exists. From the current `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py` and the four UI surfaces (`SpaceDetails.vue` → `ContributionBanner.vue` → `ContributionReview.vue` → `Contributions.vue`).

**Dead / half-baked scaffolding**
- `submitForReview()` is called with **no arguments** (`SpaceDetails.vue:360`) → `request_review` always receives `reviewers=[]`. No reviewer-picker exists.
- `Approved` status is **unreachable in production** — the frontend only ever calls `review_action` with `"Changes Requested"` (`ContributionReview.vue:520`). `"Approved"` is set only in tests.
- The `participants` child table is **never populated** anywhere.
- The multi-reviewer tally (`approved == len(cr.reviewers)`, `wiki_change_request.py:1126-1139`) is dead because `reviewers` is always empty.

**Correctness / stability**
- `review_action` (`:1099`) has **no `cr.check_permission`** and **no status guard**, and *auto-appends* the caller as a reviewer (`:1111-1118`). Any authenticated user can flip any CR to `Changes Requested`, including regressing a `Merged` CR. `resolve_merge_conflict` is the only endpoint that guards finalized status (`:1215`).
- `merge_change_request` (`:1145`) has no idempotency/status guard.
- Every `*_cr_page` mutator checks only `write` permission, never status → an `In Review` CR is still fully editable (reviewer sees a moving target).

**UX holes**
- **Reviewer feedback is invisible to the author.** On `Changes Requested`, `getRowRoute` (`Contributions.vue:171`) sends the author to `SpaceDetails`, but the comment is only rendered in `ContributionReview.vue` (`reviewNote`, `:391`). The banner the author actually sees shows a hardcoded generic string (`ContributionBanner.vue:388`).
- **Reviewer discovery is inconsistent:** the "Pending Reviews" tab is gated by `isManager` (`Contributions.vue:119,140`), but the ability to review is gated by `can_write` (`ContributionReview.vue:384`). A non-manager writer who should review can't find anything.
- **No notifications** anywhere (no `sendmail` / `publish_realtime` / Notification).
- **No preview** — only markdown diffs.
- No reviewer "reject/close"; `handleApprove()` (`ContributionReview.vue:455`) only merges and is misnamed.

---

## Phase 1 — Schema cleanup

1. **Delete child doctypes** `Wiki CR Reviewer` and `Wiki CR Participant` (`wiki/frappe_wiki/doctype/wiki_cr_reviewer/`, `wiki_cr_participant/`).
2. **`wiki_change_request.json`:**
   - Remove `reviewers`, `participants` from `field_order` and the two table fields + `section_break_participants`.
   - `status` options: `Draft\nIn Review\nChanges Requested\nApproved\nRejected\nMerged\nArchived` (drop `Open`, add `Rejected`).
   - Add review-decision fields (quick access for UI; full history lives in the timeline — see Phase 2.4):
     - `review_comment` — Small Text, read-only.
     - `reviewed_by` — Link → `User`, read-only.
     - `reviewed_at` — Datetime, read-only.
     - `rejected_at` — Datetime, read-only.
3. Regenerate the auto-typed block in `wiki_change_request.py` (via `bench`); drop the `WikiCRReviewer` / `WikiCRParticipant` imports.

**Exit:** `bench migrate` succeeds; no references to the deleted doctypes remain (`grep -r "CR Reviewer\|CR Participant\|cr_reviewer\|cr_participant"`).

## Phase 2 — Backend: review actions, guards, assignment, notifications

### 2.1 Status + edit guards (the 🔴 fixes)
- Add helper `_assert_status(cr, allowed: set[str])` and `_assert_editable(cr)` (editable = `{"Draft", "Changes Requested"}`).
- Call `_assert_editable` at the top of every mutating CR endpoint: `apply_cr_operations`, `create_cr_page`, `update_cr_page`, `move_cr_page`, `reorder_cr_children`, `delete_cr_page`.
- `merge_change_request`: require `status == "Approved"` (throw otherwise) and reject if already `Merged`/`Rejected`/`Archived`.

### 2.2 Replace `review_action` with three explicit, guarded endpoints
Delete `review_action` and `request_review`'s reviewer-table logic. New whitelisted functions, each: `cr = frappe.get_doc(...)`, **require `can_write_space(cr.wiki_space)`** (reviewer must be a space writer), require source status, set target status + the Phase-1 fields, drop a **timeline comment**, and **notify the author** (2.4).

- `submit_change_request(name)` — replaces `request_review`. Require `status in {Draft, Changes Requested}` **and** `has_revision_changes(base, head)` (server-side, not just the UI gate). Set `In Review`. (No reviewer arg.)
- `approve_change_request(name)` — require `In Review`. Set `Approved`, stamp `reviewed_by`/`reviewed_at`.
- `request_changes(name, comment)` — require `In Review` (or `Approved`). `comment` required (throw if blank). Set `Changes Requested`, store `review_comment`, stamp reviewer fields.
- `reject_change_request(name, comment)` — require `In Review` (or `Approved`). `comment` required. Set `Rejected`, stamp `reviewed_by`/`reviewed_at`/`rejected_at`, store `review_comment`. **Terminal.**
- `withdraw_change_request(name)` — **author/owner only** (`cr.owner == frappe.session.user`, managers also allowed). Require `In Review`. Set back to `Draft` (re-opens editing). No comment.
- **Approve & Merge** needs no new endpoint: the UI calls `approve_change_request` then `merge_change_request` in sequence (after the confirm dialog). If the merge surfaces conflicts, the existing conflict-resolution flow takes over and the CR is left `Approved`.

### 2.3 Assignment = Frappe native
- No code needed to *store* reviewers. Assignment is `_assign` (ToDo), created via `frappe.desk.form.assign_to.add` (manual assign button — optional, Phase 3) or by an **Assignment Rule** on `Wiki Change Request` (admin-configured, no code).
- Frappe's assignment already emails/notifies the assignee on assign — this is our "reviewer was asked" notification, for free.
- "Assigned to me" querying uses the standard `_assign like %{user}%` filter (Phase 3).

### 2.4 Notifications to the author
- On approve / request changes / reject / merge, notify the CR **owner** (the author) via `frappe.publish_realtime` + a Frappe Notification Log entry (`frappe.desk.doctype.notification_log`). Keep it small and synchronous; no email templates for v1.
- Each decision also posts a **timeline comment** on the CR (`cr.add_comment("Comment", text)`) so history is auditable and survives even though we only keep the *latest* decision in the quick-access fields.

**Exit:** unit tests in `test_wiki_change_request.py` rewritten for the new endpoints; a non-writer calling any review endpoint gets `PermissionError`; mutating an `In Review` CR throws; merging a non-`Approved` CR throws.

## Phase 3 — Rich, assignment-driven list (`Contributions.vue`)

Replace the manager-only "Pending Reviews" tab with assignment-aware tabs:

- **My Change Requests** — `owner == me` (unchanged).
- **Assigned to me** — `_assign` contains me (any space writer, not just managers). This is the reviewer's inbox. Visible to everyone; empty-state when nothing is assigned.
- **All in review** *(managers only)* — `status in [In Review, Approved]`, for oversight + manual triage.

Row → opens `ChangeRequestReview`. Status badges gain `Rejected` (red/gray). Author rows in `Changes Requested` keep routing to `SpaceDetails` to revise. Add an **Assign** affordance (uses `assign_to.add`) so a manager/author can hand a CR to a reviewer from the list or the review page — this is the only assignment UI we build; rules do the rest.

## Phase 4 — Review page (`ContributionReview.vue`)

- **Reviewer actions** (writer, `can_write`), gated on status:
  - `In Review`: primary button **Approve & Merge** (confirmation dialog → approve then merge in one step). Three-dots menu: **Approve** (approve only, no merge), **Request Changes**, **Reject**.
  - `Approved`: primary button **Merge** (plain merge; for when a *different* person approved). Three-dots still offers **Request Changes** / **Reject**.
  - Request Changes / Reject each open a dialog requiring a comment (reuse the existing reject-dialog pattern, `:241`). Approve & Merge / Merge use a simple "Are you sure?" confirm.
- **Merge** runs only when `Approved` (and conflicts resolved — existing conflict UI stays). **Approve & Merge** approves first, which satisfies that gate.
- **Author actions** (owner): `In Review` → **Withdraw** (back to `Draft`); `Draft`/`Changes Requested` → **Discard** (→ `Archived`) as today.
- Rename `handleApprove()` → `handleMerge()`; add `handleApproveAndMerge()`, `handleApprove()` (decision only), `handleRequestChanges()`, `handleReject()`, `handleWithdraw()`.
- **Surface feedback to the author (🔴 fix):** show the latest `review_comment` + `reviewed_by` + decision in **`ContributionBanner.vue`** when status is `Changes Requested` or `Rejected` (it currently shows only a hardcoded string at `:388`). The author lands on `SpaceDetails`, so the banner is where the comment must appear.
- Add a `Rejected` banner config (red, terminal, shows the reject reason + who).

## Phase 5 — Preview (how it will actually look in the docs)

Reviewers (and authors) can see the **rendered** proposed page, not just a markdown diff.

- **Backend:** reuse existing `get_cr_tree(name)` + `get_cr_page(name, doc_key)` (both already return the head-revision content). No new endpoint needed for per-page preview; add `get_cr_preview_context(name, doc_key)` only if the live renderer needs extra page chrome.
- **Frontend routes** (read-only, render with the **same component/markdown pipeline as the live reader** `WikiDocumentPanel.vue`, so preview == production):
  - `/change-requests/:id/preview` — browse the whole proposed space tree as it will look post-merge.
  - `/change-requests/:id/preview/:docKey` — a single proposed page rendered.
- **Entry points:**
  - A **Preview** button in the `ContributionReview` header (opens whole-space preview).
  - A per-change **Preview** action next to each change row's diff (opens that page's rendered preview), so a reviewer toggles between *Diff* and *Preview* per change.
- Preview is strictly read-only and available in any status (handy for the author too).

## Phase 6 — Cleanup & tests

- Remove dead frontend: `reviewers`-based code paths, `submitForReview(reviewers)` arg, `review_action` resource → new resources.
- `e2e/tests/change-request-flow.spec.ts`: extend to cover submit → assign → approve → merge, and submit → request changes → revise → resubmit, and submit → reject (terminal).
- Verify on wiki.localhost; reconcile this spec with as-built notes per the house format.

---

## Open questions

- For `Rejected`, do we want an author **"Reopen"** (→ `Draft`) action, or is Archive-and-start-over fine? (Not assumed; leaning Archive-and-start-over for v1.)
