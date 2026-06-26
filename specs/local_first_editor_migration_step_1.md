# Local-First Editor Migration: Step 1

Date: 2026-04-29

## Goal

Make the wiki editor feel local-first without changing the durable backend model yet.

Step 1 should improve perceived speed and correctness by moving immediate interaction state into the frontend, while still persisting through the existing change-request APIs:

- `create_cr_page`
- `update_cr_page`
- `delete_cr_page`
- `move_cr_page`
- `reorder_cr_children`
- `diff_change_request`
- `get_cr_tree`
- `get_cr_page`

This is intentionally not the full operation-sync API. It is the smallest migration layer that lets users create, rename, reorder, and save with immediate feedback while the backend catches up.

## Product Outcome

Authors should experience the workspace as editable immediately:

- Creating a page inserts it in the sidebar immediately.
- Renaming a page updates the header and sidebar immediately.
- Dragging a page commits visually at drag end.
- Saving content shows an honest `Saving...`, `Saved`, or `Failed` state.
- Normal edits do not spam success toasts.
- Backend failures are recoverable with retry/revert.

The backend remains the source of durable truth after sync succeeds.

## Non-Goals

- Do not replace the CR/revision backend.
- Do not add a full event-sourced operation log.
- Do not redesign review or merge.
- Do not support multi-user real-time collaboration in this step.
- Do not make offline editing a formal guarantee. Refresh protection is acceptable; offline durability can come later.

## Current Problem

Today, frontend actions are mostly server-first:

- Create/rename/delete call the backend, then load changes, then refresh the tree.
- Reorder calls `move_cr_page`, then `reorder_cr_children`, then refreshes.
- Content save marks editor state clean before the parent save confirms.
- `diff_change_request` and `get_cr_tree` are reloaded after many small edits.

This creates a slow edit loop even when the backend is functioning correctly.

## Step 1 Design

Introduce a frontend draft workspace layer that sits between existing Vue components and the current CR APIs.

The layer owns local UI state first, then performs existing backend calls in the background.

```ts
type DraftWorkspaceState = {
  spaceId: string
  crName: string | null
  tree: DraftNode[]
  pagesByKey: Record<string, DraftPage>
  changesByKey: Record<string, DraftChange>
  pending: PendingMutation[]
  sync: SyncState
}
```

```ts
type SyncState = {
  status: 'idle' | 'saving' | 'failed'
  lastSavedAt?: string
  error?: string
}
```

```ts
type DraftNode = {
  docKey: string
  serverDocKey?: string
  documentName?: string | null
  title: string
  route?: string
  parentKey?: string | null
  orderIndex?: number
  isGroup: boolean
  isPublished: boolean
  isExternalLink?: boolean
  externalUrl?: string | null
  children: DraftNode[]
  localStatus?: 'pending_create' | 'pending_update' | 'pending_delete' | 'sync_failed'
}
```

```ts
type DraftPage = {
  docKey: string
  title: string
  route?: string
  content: string
  isPublished: boolean
  dirty: boolean
  saveStatus: 'idle' | 'dirty' | 'saving' | 'saved' | 'failed'
  error?: string
}
```

```ts
type PendingMutation = {
  id: string
  type:
    | 'create_node'
    | 'update_node'
    | 'delete_node'
    | 'move_node'
    | 'update_content'
  status: 'queued' | 'syncing' | 'failed'
  payload: Record<string, unknown>
  createdAt: number
  error?: string
}
```

For Step 1, this store can be backed by Pinia and hydrated from existing resources. It does not need to persist the operation queue server-side.

## Hydration

On space load:

1. Call existing `get_or_create_draft_change_request`.
2. Call existing `get_cr_tree`.
3. Call existing `diff_change_request(scope="summary")`.
4. Normalize tree and changes into the draft workspace store.

On opening a page:

1. Existing published page: load `Wiki Document` as today.
2. Overlay/draft data: call existing `get_cr_page`.
3. Normalize into `pagesByKey`.

This keeps the backend unchanged and lets us migrate component behavior first.

## Local Mutation Rules

### Create Page Or Group

Immediate frontend behavior:

1. Validate title.
2. Generate a temporary key, e.g. `tmp_${crypto.randomUUID()}`.
3. Insert a `DraftNode` into the local tree immediately.
4. Close dialog.
5. Navigate to the temporary draft page if creating a page.
6. Mark node as `pending_create`.

Background sync:

1. Ensure CR exists.
2. Call `create_cr_page`.
3. Replace temporary key with returned `doc_key`.
4. Clear `pending_create`.
5. Refresh change summary later, debounced.

Failure:

- Mark node `sync_failed`.
- Show inline retry/delete controls in the row.
- Do not silently remove the user's new page.

### Rename Page Or Group

Immediate frontend behavior:

1. Update node title locally.
2. Update open page header locally if the page is open.
3. Mark node/page dirty.

Background sync:

1. Call `update_cr_page({ title })`.
2. Clear dirty state on success.
3. Debounce change summary refresh.

Failure:

- Keep the local title visible.
- Mark title save failed.
- Offer retry/revert.

### Edit Route

Immediate frontend behavior:

1. Update local route after basic client validation.
2. Mark route as dirty.

Background sync:

1. Call `update_cr_page({ route })`.
2. On backend validation failure, keep local route but show inline error.

Failure:

- Route field shows failed status.
- User can edit and retry.

### Toggle Publish

Immediate frontend behavior:

1. Flip local `isPublished`.
2. Update badge immediately.

Background sync:

1. Call `update_cr_page({ is_published })`.
2. Clear pending state on success.

Failure:

- Revert is acceptable here because the action is binary and cheap.
- Alternatively keep failed state if we want consistency with metadata edits.

### Delete

Immediate frontend behavior:

1. Mark node `pending_delete`.
2. Hide it from default tree view or show it struck-through depending on current design preference.

Background sync:

1. Call `delete_cr_page`.
2. Remove or keep deleted badge based on CR change summary.

Failure:

- Restore node and show error.

### Reorder

Immediate frontend behavior:

1. Let draggable mutate local tree.
2. Commit the final order visually on drag end.
3. Mark affected parent group as pending sync.

Background sync for Step 1:

1. Debounce for 500-1000ms after drag end.
2. Call existing `move_cr_page`.
3. Call existing `reorder_cr_children`.
4. Clear pending state.

Failure:

- Keep local order but mark reorder failed.
- Offer retry/revert-to-server.

Important Step 1 constraint:

The backend calls remain sequential for now. The frontend should hide this implementation detail and make the interaction immediate.

### Save Content

Immediate frontend behavior:

1. Editor marks page `dirty` on update.
2. Autosave or manual save marks page `saving`.
3. Do not mark page `saved` until backend success.

Background sync:

1. Call `update_cr_page({ content, title })`.
2. On success, update `lastSavedContent` and mark `saved`.
3. Debounce change summary refresh.

Failure:

- Keep dirty state.
- Mark save failed.
- Show retry action.

This fixes the current issue where the editor marks itself clean before parent persistence succeeds.

## Change Summary Refresh

Step 1 should stop refreshing the full change summary after every small mutation.

Use a debounced summary refresh:

- Trigger after successful create/delete/rename/reorder/content save.
- Delay by 750-1500ms.
- Coalesce multiple triggers into one `diff_change_request(scope="summary")`.
- Do not block editor interactions on the summary refresh.

Tree refresh should be reserved for:

- Initial load.
- Explicit retry/reload.
- Server reconciliation after a failed sync.
- Merge/archive/reset transitions.

## Component Migration

### New Store

Add a new Pinia store, likely:

`frontend/src/stores/draftWorkspace.js`

Responsibilities:

- Hydrate workspace from existing CR APIs.
- Own local tree state.
- Own page draft state.
- Queue and run pending mutations.
- Track per-page and per-tree sync status.
- Expose retry/revert helpers.

The existing `changeRequest` store can remain responsible for CR lifecycle actions:

- initialize CR
- submit for review
- archive
- merge
- load server-side change summary if needed

Over time, the draft workspace store may absorb more of this, but Step 1 should keep the migration small.

### Sidebar Components

Update:

- `WikiDocumentList.vue`
- `NestedDraggable.vue`
- `useTreeDialogs.js`

Desired changes:

- Read tree from draft workspace store, not directly from `treeData` props.
- Emit user intents to the store: create, rename, delete, move.
- Render pending/failed row states.
- Avoid full refresh after every mutation.

### Editor Panels

Update:

- `WikiDocumentPanel.vue`
- `DraftContributionPanel.vue`
- `WikiEditor.vue`

Desired changes:

- Page content/title/route come from draft workspace page state.
- `WikiEditor` save becomes success-aware.
- Existing and draft page panels should converge toward a shared page editor shell.

Step 1 can keep both panels but should move save-state logic into the store.

### Contribution Banner

Update:

- `ContributionBanner.vue`

Desired changes:

- Read change count from local `changesByKey` when available.
- Show a small workspace sync state:
  - `Saving...`
  - `All changes saved`
  - `Sync failed`
- Disable submit/merge while pending sync mutations exist.
- Replace normal edit success toasts with this durable state.

## Backend Changes Required For Step 1

None required.

Optional small backend improvement:

- Return updated item payload from `create_cr_page`, `update_cr_page`, `move_cr_page`, and `reorder_cr_children` instead of returning `None`/only doc key.

This would reduce the need for immediate tree refresh, but Step 1 can work without it.

## Data Consistency Rules

- Local state is authoritative for rendering while mutations are pending.
- Backend state is authoritative after successful sync.
- A failed mutation must not silently discard local user intent.
- Submit/merge must be blocked while there are pending or failed mutations.
- Refresh from server must not overwrite unsynced local changes.

## Failure UX

Use inline, contextual failures instead of global toasts for normal editing failures.

Examples:

- Page row shows `Sync failed` badge and retry icon.
- Editor header shows `Save failed. Retry`.
- Route dialog shows backend validation error beside the route field.
- Banner shows `Some changes failed to sync`.

Toasts should remain for:

- Submit success/failure.
- Merge success/failure.
- Destructive confirmation outcomes.

## Testing Plan

### Unit Tests

Add tests for draft workspace store:

- Create temp node and replace key after server success.
- Rename applies locally before server success.
- Failed rename keeps local value and marks failed.
- Reorder coalesces rapid moves.
- Save content marks dirty -> saving -> saved only after success.
- Failed content save keeps dirty state.
- Submit disabled with pending/failed mutations.

### E2E Tests

Add or update Playwright tests:

- With delayed `create_cr_page`, new page appears immediately in sidebar.
- With delayed `update_cr_page`, title changes immediately in sidebar/header.
- With failed `update_cr_page`, save state shows failure and content remains in editor.
- With delayed reorder calls, dragged order remains visible immediately.
- Submit button is disabled while local mutations are pending.

Existing tests should continue to pass:

- `e2e/tests/change-request-flow.spec.ts`
- `e2e/tests/wiki.spec.ts`
- `e2e/tests/ordering.spec.ts`

## Rollout Plan

1. Add draft workspace store behind existing CR mode.
2. Hydrate tree and changes from current APIs.
3. Move create/rename/delete to local-first store methods.
4. Move reorder to local-first store methods.
5. Move editor save status into success-aware flow.
6. Debounce change summary refresh.
7. Add pending/failed states and submit/merge blocking.
8. Remove redundant refreshes once confidence is high.

## Acceptance Criteria

- Creating a page updates the sidebar immediately before backend completion.
- Renaming a page updates sidebar/header immediately before backend completion.
- Reordering updates the tree immediately and does not visually snap back on success.
- Editor does not mark content saved until backend save succeeds.
- Failed saves and failed tree mutations are visible and retryable.
- Submit/merge are blocked while sync is pending or failed.
- Full tree refresh is not part of the normal content save path.
- Existing contribution and merge E2E flows still pass.

## Follow-Up After Step 1

Once Step 1 is stable, introduce a real backend batch endpoint:

```py
apply_cr_operations(name: str, base_version: int, operations: list[dict]) -> dict
```

That endpoint should replace the sequential frontend calls with a transactional operation-sync model. Step 1 deliberately creates the frontend abstraction that can later swap from current RPCs to this batch endpoint without rewriting the UI again.
