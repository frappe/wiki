# Local-First Editor Migration: Step 2

Date: 2026-05-01

## Goal

Replace Step 1's frontend orchestration of many change-request RPCs with a single backend operation-sync endpoint.

Step 1 made the editor feel local-first by applying mutations to the frontend draft workspace immediately, then syncing through existing APIs such as `create_cr_page`, `update_cr_page`, `move_cr_page`, `reorder_cr_children`, and `delete_cr_page`.

Step 2 should keep the same frontend interaction model, but make sync more correct, simpler, and faster by sending a compact ordered batch of operations to the backend:

```py
apply_cr_operations(name: str, base_version: int | None, operations: list[dict]) -> dict
```

The endpoint applies operations transactionally to the change request head revision, returns server-assigned keys for temp nodes, returns the canonical affected items, and reports conflicts in a shape the frontend can recover from.

## Product Outcome

Authors should not feel backend sequencing.

- Creating a page and typing immediately should never lose content when the temp page is promoted to a real key.
- Rapid edits should collapse into the latest meaningful operation payload.
- Reorder should sync as one intent, not a chain of move/reorder calls.
- Submit and merge should remain blocked until the operation queue is durably applied.
- Failed sync should be tied to the user's actual intent, not to whichever low-level RPC failed first.

The frontend remains local-first; the backend becomes an operation applier rather than a set of UI-shaped mutation endpoints.

## Non-Goals

- Do not replace the existing `Wiki Change Request`, `Wiki Revision`, or `Wiki Revision Item` model.
- Do not introduce multi-user realtime collaboration.
- Do not guarantee offline persistence across browser refreshes yet.
- Do not redesign review, merge, conflict resolution, or published-page serving.
- Do not make every old CR RPC disappear in this step. Keep compatibility until the new path is stable.

## Current Step 1 Limits

Step 1 still leaks backend shape into the frontend:

- A create returns a real `doc_key`; dependent updates must wait for temp-key resolution.
- A rename, content save, route edit, move, reorder, publish toggle, and delete each call separate RPCs.
- Reorder currently has to coordinate `move_cr_page` and `reorder_cr_children`.
- Failed temp creates need special frontend retry behavior.
- The frontend has to protect dirty local state from backend refreshes.
- Backend calls are sequential even when the user performed one conceptual action.

This is workable for the migration, but it is not the clean long-term contract.

## Step 2 Design

Add a single whitelisted backend endpoint:

```py
@frappe.whitelist()
def apply_cr_operations(
    name: str,
    base_version: int | None = None,
    operations: list[dict] | str | None = None,
) -> dict:
    ...
```

The endpoint:

1. Loads and permission-checks the `Wiki Change Request`.
2. Validates the operation batch.
3. Applies all operations inside one database transaction.
4. Resolves client temp IDs to server `doc_key`s.
5. Marks revision hashes stale once after the batch.
6. Touches the change request once after the batch.
7. Returns canonical changed items and a new workspace version.

Step 1 frontend store methods should continue to apply local state immediately. The only change is the sync adapter beneath the store: instead of calling multiple CR RPCs, it flushes queued operations to `apply_cr_operations`.

## Data Contract

### Request

```ts
type ApplyCrOperationsRequest = {
  name: string
  base_version?: number | null
  operations: CrOperation[]
}
```

`base_version` is the frontend's last known operation version for this CR workspace. It can be `null` during initial rollout, but the endpoint should return `current_version` so the frontend can start sending it.

### Response

```ts
type ApplyCrOperationsResponse = {
  ok: true
  current_version: number
  temp_key_map: Record<string, string>
  items: CrItemPayload[]
  deleted_doc_keys: string[]
  change_summary?: {
    count: number
    by_type?: Record<string, number>
  }
}
```

Failure response should use normal Frappe exception behavior for hard validation or permission failures. For recoverable version conflicts, return a structured error:

```ts
type ApplyCrOperationsConflict = {
  ok: false
  error: 'version_conflict'
  current_version: number
  server_items?: CrItemPayload[]
  message: string
}
```

If Frappe's RPC layer makes non-throwing error responses awkward, raise a typed exception with the same fields in the payload. The frontend needs to distinguish conflicts from ordinary network/server failures.

### Canonical Item Payload

Return the same shape that `get_cr_page` and `get_cr_tree` already normalize well:

```ts
type CrItemPayload = {
  doc_key: string
  title: string
  slug?: string
  route: string
  parent_key?: string | null
  order_index?: number
  is_group: boolean
  is_published: boolean
  is_external_link?: boolean
  external_url?: string | null
  document_name?: string | null
  content?: string
}
```

For content-heavy operations, include `content` for affected open pages. For pure tree operations, content can be omitted unless it was changed.

## Operation Schema

Each operation must have a client-generated ID so retries can be deduplicated later.

```ts
type CrOperationBase = {
  id: string
  type: string
}
```

### Create Node

```ts
type CreateNodeOperation = {
  id: string
  type: 'create_node'
  temp_key: string
  parent_key: string | null
  title: string
  slug?: string | null
  route?: string | null
  content?: string
  is_group?: boolean
  is_published?: boolean
  is_external_link?: boolean
  external_url?: string | null
  order_index?: number | null
}
```

Backend behavior:

- Create a `Wiki Revision Item` in the CR head revision.
- Generate a real `doc_key`.
- Map `temp_key -> doc_key`.
- Resolve `parent_key` through the same temp map if it points to a node created earlier in the same batch.
- Compute canonical route using current backend route rules unless an explicit route is accepted.
- Return the created item.

### Update Node

```ts
type UpdateNodeOperation = {
  id: string
  type: 'update_node'
  doc_key: string
  fields: {
    title?: string
    slug?: string
    route?: string
    is_group?: boolean
    is_published?: boolean
    is_external_link?: boolean
    external_url?: string | null
  }
}
```

Backend behavior:

- Resolve `doc_key` through the temp map if needed.
- Ensure an overlay item exists.
- Apply metadata fields.
- Recompute route if title/slug changes and the caller did not explicitly set route.
- Return the updated item.

### Update Content

```ts
type UpdateContentOperation = {
  id: string
  type: 'update_content'
  doc_key: string
  content: string
  title?: string
}
```

Backend behavior:

- Resolve `doc_key` through the temp map if needed.
- Ensure an overlay item exists.
- Store content through `Wiki Content Blob`.
- Optionally update title in the same operation.
- Return the updated item with content.

This operation exists separately from `update_node` because content saves are high-frequency and should be easy to coalesce.

### Delete Node

```ts
type DeleteNodeOperation = {
  id: string
  type: 'delete_node'
  doc_key: string
}
```

Backend behavior:

- Resolve `doc_key` through the temp map if needed.
- If the target was created earlier in the same batch and then deleted before sync, skip creating or mark it as a no-op.
- Otherwise mark the item and descendants deleted using the same descendant behavior as `delete_cr_page`.
- Return `deleted_doc_keys`.

### Move Node

```ts
type MoveNodeOperation = {
  id: string
  type: 'move_node'
  doc_key: string
  target_parent_key: string | null
  order_index?: number | null
}
```

Backend behavior:

- Resolve `doc_key` and `target_parent_key` through the temp map if needed.
- Ensure overlay item exists.
- Set parent and optional `order_index`.
- Return the moved item.

### Reorder Children

```ts
type ReorderChildrenOperation = {
  id: string
  type: 'reorder_children'
  parent_key: string | null
  ordered_doc_keys: string[]
}
```

Backend behavior:

- Resolve `parent_key` and every `ordered_doc_key` through the temp map.
- Set `order_index` for the listed children only if they currently belong to that parent.
- Return affected sibling items.

For frontend simplicity, drag-and-drop should usually emit one `move_node` if the parent changed and one `reorder_children` for the final sibling order. Both live in the same batch.

## Operation Ordering And Coalescing

The frontend may keep Step 1's local `pending` queue, but before flushing it should compact operations:

- Multiple `update_content` operations for the same doc collapse to the latest content.
- Multiple `update_node` operations for the same doc merge fields, with latest field value winning.
- A `create_node` followed by `update_node` for the same temp key can fold metadata into the create.
- A `create_node` followed by `update_content` for the same temp key can fold content into the create.
- A `create_node` followed by `delete_node` before sync can be dropped entirely.
- Multiple `move_node` operations for the same doc collapse to the latest parent/index.
- Multiple `reorder_children` operations for the same parent collapse to the latest order.

The backend must still process operations in the order received. The frontend coalescing is an optimization, not a correctness requirement.

## Versioning And Conflict Rules

Add a simple CR workspace version field or derive one from a monotonic value on the change request.

Preferred backend addition:

- Add `operation_version: Int` to `Wiki Change Request`, default `0`.
- Increment it once per successful `apply_cr_operations` batch.
- Return it as `current_version`.

Conflict behavior:

1. If `base_version` is `None`, accept the batch. This supports rollout and older clients.
2. If `base_version == operation_version`, apply normally.
3. If `base_version < operation_version`, return `version_conflict` and enough server state for the frontend to decide whether to reload or replay local operations.

Step 2 does not need automatic merge of simultaneous browser sessions. It only needs to avoid blindly overwriting server state when the client knows it is stale.

Frontend conflict handling for Step 2:

1. Keep local pending operations visible.
2. Mark sync failed with a conflict message.
3. Offer `Reload latest` as the first recovery.
4. Retry/replay can be a follow-up after the conflict UI is proven necessary.

## Idempotency

Each operation has an `id`, but Step 2 does not need durable server-side idempotency unless retries become unsafe.

Minimum Step 2 behavior:

- Retrying a whole failed network request is allowed only when the frontend did not receive a response.
- The frontend should retry by re-sending the same operation IDs.
- The backend may optionally keep a small child table or JSON field of recently applied operation IDs per CR to return the prior result for duplicate IDs.

Recommended implementation:

- Add `client_operation_id` tracking only if duplicate create during request timeout is observed in testing.
- Until then, rely on the frontend's failed/pending state and avoid automatic retry of unknown-completion batches.

## Backend Implementation Plan

### 1. Extract Existing Mutation Helpers

Refactor current whitelisted functions so they share internal helpers:

- `_create_cr_item(cr, parent_key, title, ...) -> dict`
- `_update_cr_item(cr, doc_key, fields) -> dict`
- `_delete_cr_item(cr, doc_key) -> list[str]`
- `_move_cr_item(cr, doc_key, parent_key, order_index) -> dict`
- `_reorder_cr_children(cr, parent_key, ordered_doc_keys) -> list[dict]`
- `_serialize_cr_item(cr, doc_key, include_content=False) -> dict`

Existing RPCs should call these helpers so old behavior remains intact.

### 2. Add Operation Applier

Implement:

```py
def _apply_operation(cr, operation, temp_key_map) -> OperationResult:
    ...
```

Rules:

- Validate required fields per operation type.
- Reject unknown operation types.
- Resolve temp keys through `temp_key_map`.
- Track affected doc keys.
- Defer `mark_hashes_stale` and `touch_change_request` until the batch completes.

### 3. Add Whitelisted Endpoint

`apply_cr_operations` should:

1. Parse JSON string input if Frappe passes `operations` as a string.
2. Validate `operations` is a non-empty list.
3. Check write permission.
4. Check `base_version`.
5. Apply operations in order.
6. Increment `operation_version`.
7. Commit by returning normally.

If any operation fails, the whole batch should fail. Frappe's request transaction should roll back the partial changes.

### 4. Return Useful Payloads

The endpoint should return:

- `temp_key_map`
- `items`
- `deleted_doc_keys`
- `current_version`
- optionally a cheap `change_summary`

Avoid forcing the frontend to call `get_cr_tree` immediately after a successful batch.

## Frontend Migration Plan

### 1. Add Sync Adapter

Add a small adapter under the draft workspace store, for example:

```js
async function applyOperations(operations) {
  return applyOperationsResource.submit({
    name: crName.value,
    base_version: operationVersion.value,
    operations,
  });
}
```

Keep the local mutation API unchanged:

- `createNode`
- `updateNode`
- `deleteNode`
- `moveNode`
- `saveContent`

Only the backend flush path changes.

### 2. Store Server Version

Add:

```ts
operationVersion: number | null
```

Hydrate it from `get_change_request`, `get_or_create_draft_change_request`, or a small addition to `get_cr_tree`.

### 3. Convert Pending Mutations To Operations

Map Step 1 pending mutations to Step 2 operations:

- `create_node` -> `create_node`
- `update_node` -> `update_node`
- `delete_node` -> `delete_node`
- `move_node` -> `move_node` and/or `reorder_children`
- `update_content` -> `update_content`

Do this in one place. UI components should not know about backend operation details.

### 4. Apply Response To Local Store

On success:

- Promote temp keys using `temp_key_map`.
- Merge returned `items` into `tree` and `pagesByKey`.
- Clear successful pending operations.
- Clear `localStatus` on affected nodes.
- Mark saved content clean only when the returned item matches the submitted content.
- Update `operationVersion`.

On failure:

- Keep local state.
- Mark affected pending operations failed.
- Keep submit/merge blocked.

### 5. Keep Old RPC Fallback Temporarily

Add a feature flag or store-level switch:

```js
const useBatchOperations = true;
```

For rollout, keep the Step 1 RPC path available until tests and QA pass.

## Failure UX

Step 2 should make failure recovery clearer because the failed unit is now a user intent.

- Batch network failure: banner says `Sync failed. Retry`.
- Validation failure on route/title: mark the specific field/row failed.
- Conflict: banner says `This draft changed elsewhere. Reload latest.`
- Partial UI should never disappear because the batch failed.

Do not show success toasts for ordinary edit sync.

## Testing Plan

### Backend Unit Tests

Add tests near `test_wiki_change_request.py`:

- `apply_cr_operations` creates a page and returns `temp_key_map`.
- Create + content update for the same temp key in one batch persists content.
- Create child under temp parent resolves both keys.
- Update title + route returns canonical item.
- Delete group marks descendants deleted.
- Move + reorder in one batch produces expected tree order.
- Unknown operation type rolls back the whole batch.
- Invalid doc key rolls back the whole batch.
- `base_version` increments on success.
- Stale `base_version` returns or raises a structured conflict.

### Frontend Unit Tests

Add draft workspace tests for:

- Pending queue compaction.
- Mapping pending mutations to operation payloads.
- Applying `temp_key_map` without losing open editor content.
- Marking pending operations clear only after successful response.
- Conflict response keeps local dirty state.

### E2E Tests

Add browser tests with delayed `apply_cr_operations`:

- Create new page, type immediately, wait for sync, content remains.
- Rename while sync is delayed, sidebar and header stay updated.
- Reorder while sync is delayed, order does not snap back.
- Failed batch blocks submit/merge and shows retry.
- Retry successful batch clears failed state.

Existing Step 1 delayed old-RPC tests can be rewritten to intercept `apply_cr_operations`.

## Rollout Plan

1. Implement backend helpers and `apply_cr_operations`.
2. Add backend tests.
3. Add frontend sync adapter behind a flag.
4. Convert content save and create flow first, because they have the highest data-loss risk.
5. Convert metadata updates.
6. Convert delete and reorder.
7. Run E2E tests against delayed and failed batch endpoint.
8. Enable batch endpoint by default.
9. Remove old frontend orchestration after one stable cycle.

## Acceptance Criteria

- A new page can be created and edited while the create sync is delayed; content is not lost.
- A single batch can create a page and save content for it using only the temp key.
- Reorder sync uses one batch and does not require visual rollback on success.
- Submit/merge are blocked while a batch is pending or failed.
- Backend applies a batch atomically: if one operation fails, none of the batch changes persist.
- Backend returns enough item data for the frontend to avoid immediate `get_cr_tree` after success.
- Existing old CR RPCs still work during rollout.
- Tests cover delayed create/content and failed batch recovery.

## Follow-Up After Step 2

Once operation sync is stable, Step 3 can decide whether to persist the frontend operation queue for real offline durability:

- Store pending operations in IndexedDB.
- Restore unsynced drafts after browser refresh.
- Add durable server-side operation idempotency.
- Add conflict replay tools for multiple browser sessions.

Step 2 should not take on that durability scope. Its job is to make the sync contract elegant and atomic while preserving the Step 1 local-first experience.
