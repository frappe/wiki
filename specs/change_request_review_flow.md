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

## Delivery plan — tracer bullets

The work is sliced **vertically**, not by layer. Each bullet pierces every layer (DB schema → whitelisted endpoint → Vue UI → visible behavior) and ends in something exercisable on wiki.localhost, so the architecture gets feedback early. The layer-grouped breakdown this replaces would not have shown a working flow until the very end.

Commit after each bullet. The reference detail (field names, endpoint contracts, file/line anchors) lives inline under each bullet.

### Bullet 1 — Walking skeleton: the self-serve happy path
**Slice:** `Draft → submit → In Review → Approve & Merge → Merged`, for an author merging their own CR (no second person, no assignment).

- **Schema:**
  - **Delete child doctypes** `Wiki CR Reviewer` and `Wiki CR Participant` (`wiki/frappe_wiki/doctype/wiki_cr_reviewer/`, `wiki_cr_participant/`).
  - **`wiki_change_request.json`:** remove `reviewers`, `participants` from `field_order` + the two table fields + `section_break_participants`; `status` options `Draft\nIn Review\nChanges Requested\nApproved\nRejected\nMerged\nArchived` (drop `Open`, add `Rejected`); add review-decision fields (quick access; full history is the timeline — Bullet 5): `review_comment` (Small Text, read-only), `reviewed_by` (Link → `User`, read-only), `reviewed_at` (Datetime, read-only), `rejected_at` (Datetime, read-only).
  - Regenerate the auto-typed block in `wiki_change_request.py` (via `bench`); drop the `WikiCRReviewer` / `WikiCRParticipant` imports.
- **Backend:**
  - Helpers `_assert_status(cr, allowed: set[str])` and `_assert_editable(cr)` (editable = `{"Draft", "Changes Requested"}`). Call `_assert_editable` at the top of every mutating CR endpoint: `apply_cr_operations`, `create_cr_page`, `update_cr_page`, `move_cr_page`, `reorder_cr_children`, `delete_cr_page`.
  - `submit_change_request(name)` — replaces `request_review` (no reviewer arg). Require `status in {Draft, Changes Requested}` **and** `has_revision_changes(base, head)` (server-side, not just the UI gate). Set `In Review`.
  - `approve_change_request(name)` — require `can_write_space(cr.wiki_space)` + `In Review`. Set `Approved`, stamp `reviewed_by`/`reviewed_at`, post a **timeline comment** (`cr.add_comment("Comment", text)`).
  - `merge_change_request` — require `status == "Approved"` (throw otherwise) and reject if already `Merged`/`Rejected`/`Archived`.
- **Frontend:** one primary **Approve & Merge** button in the review header (confirm dialog → `approve_change_request` then `merge_change_request` in sequence; on conflict, existing conflict-resolution flow takes over and the CR is left `Approved`). Wire submit with no reviewer arg; delete the always-`reviewers=[]` call (`SpaceDetails.vue:360`).

**Validates:** the new state machine, edit-locking, the merge gate, and that the reviewer/participant tables can be dropped without breaking submit.
**Exit:** `bench migrate` succeeds; no references to the deleted doctypes remain (`grep -r "CR Reviewer\|CR Participant\|cr_reviewer\|cr_participant"`); the full self-serve lifecycle runs on wiki.localhost.

**As-built (2026-06-19):** ✅ Done.
- Deleted `Wiki CR Reviewer` / `Wiki CR Participant`; DB tables dropped by post-model-sync patch `drop_reviewer_participant_tables`. `status` options updated (dropped `Open`, added `Rejected`); added `review_comment` / `reviewed_by` / `reviewed_at` / `rejected_at`.
- Backend: `_assert_status` / `_assert_editable` (editable = `{Draft, Changes Requested}`) guard all six CR mutators (`apply_cr_operations` + the five legacy RPCs). Added `submit_change_request` (replaces `request_review`; server-side `has_revision_changes` gate) and `approve_change_request` (writer-only, stamps reviewer fields, posts timeline comment). `merge_change_request` now requires `status == "Approved"`. Removed `request_review` / `review_action` and the now-dead `_is_manager_or_approver`.
- Frontend: store `submitForReview()` → `submit_change_request` (no reviewer arg); `ContributionReview.vue` primary **Approve & Merge** button + confirm dialog (`handleApproveAndMerge` → approve then `mergeNow`), `handleApprove` renamed `handleMerge` (shown when already `Approved`). Removed the `review_action`-backed Request Changes dialog and the `reviewers`-based `reviewNote` (return in Bullets 2–3).
- Tests: rewrote the three obsolete reviewer tests into submit / approve→merge / merge-gate / edit-lock / approve-permission cases; merge-machinery tests route through an `_approve_and_merge` helper. `bench migrate` green; 70 tests pass; `yarn build` clean.

### Bullet 2 — Reviewer feedback round-trip
**Slice:** reviewer **Request Changes** (comment) → `Changes Requested` → **author sees the comment** → edits → resubmits.

- **Backend:** `request_changes(name, comment)` — require `can_write_space` + status `In Review` (or `Approved`); `comment` required (throw if blank). Set `Changes Requested`, store `review_comment`, stamp reviewer fields, post timeline comment.
- **Frontend:** three-dots **Request Changes** dialog (reuse the existing reject-dialog pattern, `ContributionReview.vue:241`); surface the latest `review_comment` + `reviewed_by` in **`ContributionBanner.vue`** when status is `Changes Requested` (🔴 fix — it currently shows only a hardcoded string at `:388`); resubmit reuses Bullet 1's submit.

**Validates:** the author↔reviewer loop, the feedback-visibility fix, and that `Changes Requested` correctly re-opens editing.

### Bullet 3 — Complete the state machine
**Slice:** **Reject** (terminal) and **Withdraw** (author pulls `In Review` back to `Draft`).

- **Backend:** `reject_change_request(name, comment)` — `can_write_space` + status `In Review` (or `Approved`); `comment` required. Set `Rejected`, stamp `reviewed_by`/`reviewed_at`/`rejected_at`, store `review_comment`, post timeline comment. **Terminal.** `withdraw_change_request(name)` — author/owner only (`cr.owner == frappe.session.user`; managers also allowed), require `In Review`, set back to `Draft`, no comment.
- **Frontend:** Reject dialog (comment required); red terminal **Rejected** banner config (shows reason + who) in `ContributionBanner.vue`; Withdraw button for the author; `Rejected` status badge (red/gray).
- Rename `handleApprove()` → `handleMerge()`; add `handleApproveAndMerge()`, `handleApprove()` (decision only), `handleRequestChanges()`, `handleReject()`, `handleWithdraw()`.

**Validates:** every transition in the settled diagram is now reachable from the UI; Withdraw re-opens editing.
**Exit:** unit tests in `test_wiki_change_request.py` rewritten for the new endpoints; a non-writer calling any review endpoint gets `PermissionError`; mutating an `In Review` CR throws; merging a non-`Approved` CR throws.

### Bullet 4 — Native assignment + the two-person path
**Slice:** a reviewer who isn't the author finds an assigned CR, **Approves** (decision only), and someone **Merges** the now-`Approved` CR.

- **Backend:** no storage code — assignment is `_assign` (ToDo), created via `frappe.desk.form.assign_to.add` or an **Assignment Rule** on `Wiki Change Request` (admin-configured, no code). Frappe's assign already emails/notifies the assignee — our "reviewer was asked" notification, for free. `approve_change_request` and the plain merge already exist from Bullet 1.
- **Frontend (`Contributions.vue`):** replace the manager-only "Pending Reviews" tab with assignment-aware tabs — **My Change Requests** (`owner == me`, unchanged), **Assigned to me** (`_assign like %{user}%`; any space writer, empty-state when nothing assigned), **All in review** *(managers only)*, `status in [In Review, Approved]`. Status badges gain `Rejected`; author rows in `Changes Requested` keep routing to `SpaceDetails`. Add an **Assign** affordance (uses `assign_to.add`) on the list and review page — the only assignment UI we build; rules do the rest. In `ContributionReview.vue`: standalone **Approve** (no merge) in three-dots + primary **Merge** on `Approved` (for when a *different* person approved); three-dots still offers Request Changes / Reject.

**Validates:** the spec's biggest architectural bet — Frappe's native `_assign`/ToDo replaces the custom reviewer table for discovery, the reviewer inbox, and the assign notification.

### Bullet 5 — Notifications (thin cross-cut)
**Slice:** the author gets a realtime ping + Notification Log entry on approve / request-changes / reject / merge.

- `frappe.publish_realtime` + a Frappe Notification Log entry (`frappe.desk.doctype.notification_log`) to the CR **owner**. Small and synchronous; no email templates for v1.
- The per-decision **timeline comment** is *not* deferred here — it ships with each endpoint in Bullets 1–3. This bullet is only the realtime/notification-log plumbing.

**Validates:** notification plumbing end-to-end.

### Bullet 6 — Preview (rendered, == production)
**Slice:** a reviewer/author sees the **rendered** proposed page, not just a markdown diff.

- **Backend:** reuse `get_cr_tree(name)` + `get_cr_page(name, doc_key)` (both already return head-revision content). Add `get_cr_preview_context(name, doc_key)` only if the live renderer needs extra page chrome.
- **Frontend routes** (read-only, rendered with the **same pipeline as the live reader** `WikiDocumentPanel.vue`, so preview == production): `/change-requests/:id/preview` (whole proposed tree post-merge) and `/change-requests/:id/preview/:docKey` (single page). Entry points: a **Preview** button in the `ContributionReview` header, and a per-change Diff/Preview toggle next to each change row. Read-only, available in any status.

**Validates:** the second architectural bet — preview == production via the shared render pipeline. Cleanly separable, so it rides last among the feature slices.

### Bullet 7 — Harden & finish
- Remove remaining dead frontend: `reviewers`-based code paths, `submitForReview(reviewers)` arg, `review_action` resource → new resources.
- `e2e/tests/change-request-flow.spec.ts`: cover submit → assign → approve → merge, submit → request changes → revise → resubmit, and submit → reject (terminal).
- Verify on wiki.localhost; reconcile this spec with as-built notes per the house format.

### Ordering note
The two architectural bets — native `_assign` (Bullet 4) and preview == production (Bullet 6) — are placed mid/late because the self-serve happy path (Bullet 1) needs neither, and a demoable spine early has its own value. If de-risking the framework bets sooner matters more, pull Bullet 4 to position 2.

---

## Open questions

- For `Rejected`, do we want an author **"Reopen"** (→ `Draft`) action, or is Archive-and-start-over fine? (Not assumed; leaning Archive-and-start-over for v1.)
