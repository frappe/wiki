# Durable Draft Sync: Per-Page Checks, Client Keys, Operation Log

Date: 2026-11-02
Status: **In progress**. Bullet 1 built, bullets 2 and 3 not started. Roadmap item 3.1 (R1, R2, R3) in `pr-859-roadmap.md`.

## Goal

An edit is never lost or overwritten without the user being told. Reload, a lost reply, a second tab or a second device must not change that.

## Why

Reproduced in a browser on `develop` at `6e0e09ed`. The first row is live data loss. The rest lose work or block saves after a failure.

| Scenario | What happens today |
|---|---|
| Tab B saves a page. Tab A, on the same page, goes to All Spaces and back, then saves | B's edit is gone, with no alert |
| Two tabs edit different pages | False "Changed elsewhere", saves blocked until Reload latest |
| Typing while a create is in flight | Editor remounts, cursor jumps to the start, undo history is gone. Typed `w00 ... w29`, got `w10 ... w29w00 ... w09` |
| Reply to a create is lost | Empty page on the server, tab stuck on `/draft/tmp_*`, every save fails, reload loses the text |
| Reply to a save is lost | False "edited in another tab" |
| Unsynced create, then reload | "Draft not found", text gone, IndexedDB entry never cleaned |
| Unsynced rename or delete, then reload | Lost, with no warning |
| Move, then reload within 750 ms | Lost. No request was sent |
| Batch sent twice without `base_version` | 2 pages created |

Root causes:

1. The only guard is one `operation_version` per change request. It cannot tell which page changed, and any tree fetch adopts a new version while the open editor keeps its old text.
2. A new page has no real key until the server replies.
3. The operation queue lives in memory.

## Order

Three tracer bullets, each its own PR, each useful alone. The per-page check goes first because it fixes the only silent data loss and needs nothing from the other two.

| Bullet | Fixes | Schema |
|---|---|---|
| 1. Per-page check | Silent overwrite, false conflicts, false conflict after a lost save reply | `structure_version` on Wiki Change Request |
| 2. Client keys | Remount while typing, stranded creates, about 125 lines of `tmp_*` handling | None |
| 3. Operation log | Lost renames, deletes, moves and creates on reload, double applies | `applied_op_ids` on Wiki Change Request |

## Bullet 1: Per-page check

### Content

Wiki Content Blob already stores `hash`, the SHA-256 of the content. No new content field.

- `get_cr_page` and `_serialize_cr_item` (when it includes content) return `content_hash`. An item with no blob reports the hash of the empty string.
- `update_content` takes an optional `base_content_hash`.
- `apply_cr_operations` checks every such op before its first write, under the existing change request lock:

| Current hash on the server | Result |
|---|---|
| Same as `base_content_hash` | Apply |
| Same as the hash of the incoming content | Apply. It writes the same text, which covers a retry after a lost reply and two tabs saving the same text |
| Anything else | `{"ok": false, "error": "page_conflict", "doc_key": ..., "message": ...}`. Nothing in the batch is written |
| No `base_content_hash` sent | Apply, as today |

The check runs before any write because a returned error still commits the request. Ops whose `doc_key` is a temp key in the same batch skip it.

A batch that waited on the lock still reads from its old snapshot, so a plain read would miss the save ahead of it. `_assert_snapshot_is_current` compares the locked `operation_version` with a plain read and throws `TimestampMismatchError` if they differ. Nothing is written, and the next save retries.

### Structure

A move or reorder depends on the sibling list the client sees, so a stale one can misplace pages. Per-page hashes cannot see that.

- New hidden Int field `structure_version` on Wiki Change Request, default 0. No backfill.
- A batch with a create, delete, restore, move or reorder bumps it once and returns it. The older endpoints that change the tree bump it too. `get_cr_tree` returns it.
- The client adopts a returned version only if it is one above its own. A bigger jump means another tab changed the tree, so a later move must still conflict. This is why the bump is per batch, and why a batch that leaves the tree alone returns nothing.
- A batch with `move_node` or `reorder_children` may send `base_structure_version`. If it is behind, the reply is `{"ok": false, "error": "structure_conflict", ...}`.

Create, delete, restore and `update_node` send no guard. A create appends, a delete and a restore set a flag, and a rename is an explicit act, so the last one wins.

### `base_version` stays

`base_version` and `version_conflict` keep their meaning for API callers. `wikitool` sends them and agents rely on them. The SPA stops sending `base_version`.

### Client

`serverContent` already means "the copy the local edits build on". Add `serverHash` next to it in the page buffer and in the IndexedDB draft. It moves only together with `serverContent`.

- `doSaveContent` sends `base_content_hash: page.serverHash`, then reads the new hash from `items` in the reply.
- A save with `sentContent` set first resends that text with the old hash. The server accepts it if it already has it, and the newer text follows with the new hash. A server-reported error rolled the save back, so it does not set `sentContent`. This replaces the false conflict after a lost reply.
- **Close the hole behind the silent overwrite.** `revalidateCrPage` updates the buffer, but the open editor keeps its text and then reports it as a local edit. When the reply arrives, call `requestEditorFlush()` to record any typing still in the 300 ms debounce. If the page is clean and its hash changed, apply the fetched copy and call `requestEditorReload`. If it is dirty, keep `serverHash`, so the next save gets `page_conflict` and the user is told. If `serverHash` moved during the fetch, our own save landed, so drop the reply: it would put the old text back in the editor.
- **Stop sending the title with content.** `update_content` from the SPA carries no `title`. Otherwise a stale title undoes a rename now that no version check blocks it. A save calls `saveTitleIfChanged` first, so a title still being typed goes out with the autosave as `update_node`.
- `crSyncState.conflict` becomes a set of conflicting pages plus a structure flag. A conflict on one page blocks saves for that page only. A structure conflict blocks moves and reorders only. Alert copy and Reload latest stay as they are.
- A draft in IndexedDB saved before this change has no `serverHash`. `restorePersistedDrafts` already compares it with the server copy, so it takes the fetched hash when the draft is still based on that copy.

### Tests

Backend:

- `content_hash` from `get_cr_page`, and from a batch reply
- Matching hash applies, stale hash returns `page_conflict`, same content succeeds with no write, no hash applies
- A stale op later in a batch leaves the earlier ops unwritten
- Stale `base_structure_version` returns `structure_conflict`, a content save does not bump it
- `base_version` still behaves as before

Playwright, in `draft-version-conflict.spec.ts`:

- All Spaces and back: tab A shows B's text, and A's save keeps it. Fails today
- Same, with unsaved typing in A: alert shows and the server keeps B's text
- Two tabs on different pages: both save, no alert. Fails today, and replaces "reload latest keeps edits to pages nobody else changed"
- Lost save reply, then more typing: both reach the server, no alert. Fails today
- Rename in tab B, content save in tab A: the rename survives
- Stale reorder: alert shows, Reload latest clears it

Docs in the same PR: `ARCHITECTURE.md` and the agent skill's `reference/api.md`.

## Bullet 2: Client keys

The client picks the permanent `doc_key` when it creates a page. Nothing is promoted, the route never changes, and the editor is not remounted.

### Key format

32 hex characters from `crypto.getRandomValues`.

- A standard UUID fails `WIKI_LINK_PATTERN` (`\w+`) and `DOC_KEY_PATTERN` in `og_image.py` (`[a-zA-Z0-9]{1,32}`). Both were tested.
- `crypto.randomUUID` needs HTTPS, so it is missing on a plain HTTP self-hosted site. `getRandomValues` is not limited this way.

### Server

`create_node` takes an optional `doc_key`. `temp_key` becomes optional when `doc_key` is sent, and `temp_key` and `temp_key_map` stay for `wikitool`.

**This is a security boundary.** `_save_changed_documents` looks up `doc_key` across all spaces, so that a merge can pull a page back from another space. Tested with a foreign key written into a head revision: the merge overwrote that page and moved it into the merging space. The server therefore checks before insert:

| Check | Result |
|---|---|
| Not `^[a-zA-Z0-9]{12,32}$` | Reject |
| Exists in Wiki Document | Reject |
| Exists in the change request's base revision | Reject |
| Exists only in this change request's overlay | Success, no write. This is a retried create |
| Otherwise | Insert with this key |

A key in another user's unmerged change request is not checked: `doc_key` has no index of its own on Wiki Revision Item, and adding one for this is not worth it. Keys are random, so reusing one takes a user who can already read that change request. If both then merge, the second merge overwrites the first's page. A reviewer sees that page as an addition in the second review.

### Client

Delete `tempKeyResolver.js`, `promoteKey`, the three `rewriteKeys`, `serverDocKey`, the promotion watcher in `DraftContributionPanel.vue`, and the `findNode(realKey) || findNode(docKey)` lookups. `createNode` keeps its return shape with `docKey` in place of `tempKey`. A failed create stays on screen with `sync_failed`, and retrying it is safe.

`page-links.js` still waits for the create before it writes the link, so a failed create cannot leave a dead link in content.

### Tests

- Backend: each row of the table above. Merge test: a rejected foreign key leaves the other space's page untouched
- Playwright: typing through a delayed create keeps order, cursor, undo and URL (fails today). A lost create reply: the next save succeeds and the text reaches the server (fails today)

## Bullet 3: Operation log

### Log

Every structural and metadata change is written to IndexedDB before it is sent. Entries sit in the `wiki-drafts` store as `log:<change request>:<op id>`, with `{opId, seq, type, payload}`. The write starts in the same tick as the UI update, and the flusher waits for it before it sends.

**Content stays out of the log.** The draft store already holds it durably, it is coalesced to the latest text, and bullet 1 guards it. The log carries `create_node`, `update_node`, `delete_node`, `restore_node`, `move_node` and `reorder_children`.

`operationQueue.js` and `moveScheduler.js` become one flusher per change request:

- Sends entries in order, and removes each when acknowledged
- Coalesces queued moves of the same page, as today, but never changes an entry already sent
- Retries network errors with backoff
- Drops an entry the server rejects with a validation or permission error, then reloads the tree. Rollback is always "drop the op", which replaces today's four different behaviours
- Holds structure entries on `structure_conflict` until Reload latest, which discards them

Store methods keep returning promises that settle on acknowledgement, so callers do not change.

### Reload

`hydrate` loads the tree, replays the log on top of it, restores drafts, then starts the flusher. A page created offline is back in the tree before its draft is restored, so it reopens with its text. Leftover `tmp_*` drafts are deleted once. `clearDraftsForCr` also clears the log.

### Server dedupe

Ops carry a new `op_id`. The existing `id` cannot serve: `wikitool` sends `op-1`, `op-2` in every batch, and moves send `<parent>-reorder`.

- New hidden field `applied_op_ids` on Wiki Change Request: JSON list of the last 200 ids. It is read and written under the existing row lock, so it needs no new table and no cleanup job.
- An op whose `op_id` is in the list is skipped, and skipped ops do not count for either check in bullet 1. Pages it touched still appear in `items`, so the client learns the current hash.
- No `op_id` means no dedupe, so API callers do not change.

Ceiling: 200 ids. A retry arriving after 200 newer ops applies again. That is harmless for everything except a rename or move that someone changed since, and it needs an offline tab to come back after 200 ops. A table would remove the ceiling if this ever shows up.

### Tabs

No BroadcastChannel or Web Locks. Two tabs can both send one entry, and `op_id` makes that safe. They would only cut duplicate requests, a second device would still need the server checks, and `navigator.locks` also needs HTTPS. Add them if duplicate requests show up in practice.

### Tests

- Backend: replayed `op_id` writes nothing and is dropped from the checks, the list stays capped, ops with no `op_id` always apply
- Playwright, each fails today: offline rename, delete and create survive a reload and reach the server. A move followed by a reload within 750 ms survives. A lost reply on a rename, retried: applied once. A rejected op drops out and the tree matches the server

## Not in scope

- Merging two versions of a page. A conflict still means Reload latest
- Showing which page conflicted in the alert. The conflict state now knows, so it can follow
- Normalizing the client store (3.5)
- Removing the older `create_cr_page`, `update_cr_page` and similar endpoints. The agent skill documents them

## Risks

- **Reseeding an open editor.** `requestEditorReload` moves the cursor. It fires only when the page changed elsewhere and the editor has no unsaved typing, and the Playwright test with unsaved typing covers the other branch.
- **A hash stops matching.** Blob content is stored verbatim and the server computes every hash, so the client never hashes. A failure here shows as a false conflict, not as lost data.
- **Older open tabs during a deploy.** A tab on the old build keeps sending `base_version`, and the server still honours it. It does not see `structure_version`, and it stays safe through `operation_version`.
- **Two tabs saving in the same instant.** One gets `TimestampMismatchError`, shown as a failed save. The next save retries it. A false failure here is safe, and an automatic retry can follow if it shows up in practice.
