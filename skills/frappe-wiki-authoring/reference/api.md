# Wiki v3 change-request API reference

Method prefix throughout:

```
CR = wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request
```

All calls are `POST /api/method/<dotted.path>` with named params as the JSON body.
The source is `wiki/frappe_wiki/doctype/wiki_change_request/wiki_change_request.py` in the
`frappe/wiki` repo. If you have it, find a function with `grep -n "def <name>"`. Nothing
here needs it. `scripts/wikictl.py` wraps the
common paths; this file is for everything it does not cover.

## Data model

| DocType | Role |
|---|---|
| **Wiki Space** | Owns `main_revision` (published pointer), `root_group` (a Wiki Document name), `allow_contributions`, `git_synced`, and a `roles` child table (Wiki Space Role: `role` + `permission_level` Read\|Write) |
| **Wiki Change Request** | A branch: pins `base_revision`, owns mutable `head_revision`. Plus `status`, `operation_version`, `review_comment`, `reviewed_by/at`, `merge_revision`, `merged_by/at`, `outdated` |
| **Wiki Revision** | Immutable snapshot. `tree_hash` / `content_hash` drive change detection. Flags: `is_working`, `is_overlay`, `is_merge`, `hashes_stale` |
| **Wiki Revision Item** | One page in one revision. Standalone (not a child table). `doc_key`, `parent_key` (parent's doc_key, not a Link), `route`, `slug`, `order_index`, `content_blob`, `is_deleted` tombstone |
| **Wiki Content Blob** | Content-addressed by `hash`, deduped. `content_type` defaults `"markdown"` |
| **Wiki Document** | The live published tree (NestedSet). Reconciled from the merge revision. Shares `doc_key` with its Revision Item |
| **Wiki Merge Conflict** | `conflict_type` (`content`\|`meta`\|`tree`), `status` (`Open`\|`Resolved`), `base/ours/theirs_payload`, `resolution` |

## Identifiers

| Name | Example | Notes |
|---|---|---|
| Space docname | `en0gc980kr` | What every API takes |
| Space route | `buzz` | Never an API argument |
| `doc_key` | `487291614eed` | Stable page identity; survives merge into the live tree |
| `temp_key` | `tmp-1` | Valid only within one `apply_cr_operations` call |

**`root_group` is overloaded.** `Wiki Space.root_group` is a *Wiki Document name*;
`get_cr_tree(...)["root_group"]` is the *doc_key*, already resolved. Use the tree's value
directly as `parent_key`.

`parent_key: null` is not "root" — the node is stored but excluded from
`doc_map[root_key]["children"]` and becomes permanently invisible.

## Read

| Method | Params | Returns |
|---|---|---|
| `$CR.get_change_request` | `name` | Full CR dict |
| `$CR.list_change_requests` | `wiki_space`, `status?` | `[{name, title, status, base_revision, head_revision, merge_revision, outdated, modified, merged_at, merged_by, owner, ...}]`, newest first |
| `$CR.get_cr_tree` | `name` | `{children: [nested nodes with _changeType], root_group: <doc_key>, operation_version: int}` |
| `$CR.get_cr_page` | `name`, `doc_key` | `{doc_key, title, slug, route, is_group, is_tab, tab_icon, is_published, is_external_link, external_url, parent_key, order_index, document_name, content}` |
| `$CR.diff_change_request` | `name`, `scope="summary"`, `doc_key?` | `summary` → `[{doc_key, change_type, title, is_group, is_tab, is_external_link, external_url}]`; `scope="page"` → `{doc_key, base, head, location}` with full content on both sides |
| `$CR.check_outdated` | `name` | `0` \| `1`; also persisted to `outdated` |
| `$CR.check_route_available` | `wiki_space`, `route`, `cr_name?`, `exclude_doc_key?` | `{route: <sanitized>, available: bool}` — **advisory only** |
| `wiki.api.get_space_capabilities` | `space` | `{can_read, can_write, can_contribute, can_delete}` |

`change_type` ∈ `added` \| `modified` \| `deleted` \| `reordered`.

## Create / edit

### `$CR.get_or_create_draft_change_request`
Params `wiki_space`, `title?` → CR dict. Reuses the caller's newest `Draft` /
`Changes Requested` CR in that space, preferring one that already has changes; archives a
stale empty draft first. Bootstraps `main_revision` if the space has none.

### `$CR.create_change_request`
Params `wiki_space`, `title` (required), `description?` → CR doc. Always fresh.

### `$CR.update_change_request`
Params `name`, `title?`, `description?`.

### `$CR.apply_cr_operations` — the main write endpoint
Params `name`, `base_version` (int \| null), `operations` (list \| JSON string).

Success:
```json
{"ok": true, "current_version": 4,
 "temp_key_map": {"tmp-1": "487291614eed"},
 "items": [ /* serialized, with content for touched keys */ ],
 "deleted_doc_keys": ["..."],
 "change_summary": {"count": 1, "by_type": {"create_node": 1}}}
```

Stale — **HTTP 200, exit code 0**:
```json
{"ok": false, "error": "version_conflict", "current_version": 4,
 "message": "This draft has changed elsewhere. Reload latest."}
```

Whole batch is one transaction. `_resolve_temp_key` substitutes temp keys in
`parent_key` / `doc_key` / `target_parent_key` for ops later in the same batch.

#### Operation types (`_apply_operation`

| `type` | Fields |
|---|---|
| `create_node` | `temp_key` (req), `title` (req), `parent_key` (req in practice), `slug`, `route`, `content`, `is_group`, `is_published` (default true), `is_external_link`, `external_url`, `order_index`, `is_tab`, `tab_icon` |
| `update_content` | `doc_key` (req), `content` (req), `title?` |
| `update_node` | `doc_key` (req), `fields{}` |
| `delete_node` | `doc_key` (req) — cascades to descendants |
| `restore_node` | `doc_key` (req) — undoes a deletion staged in this CR, with its descendants |
| `move_node` | `doc_key` (req), `target_parent_key` (req), `order_index?` |
| `reorder_children` | `parent_key` (req), `ordered_doc_keys[]` (req) |

`id` is a client correlation string; the backend does not validate it.

#### `fields` allowlist for `update_node` / `update_cr_page`
- Scalars: `title`, `slug`, `route`, `external_url`, `tab_icon`
- Checkboxes: `is_group`, `is_published`, `is_external_link`, `is_deleted`, `is_tab`
- Plus `content` (string) — `_update_cr_item` handles it at

`None`/`null` values are **silently dropped**, so you cannot clear a field with
`null`. Use `""`. `route` is passed through `sanitize_route`.

`update_content` differs from `update_node` with a `content` field only in that it registers
the key in `content_doc_keys`, so the response echoes content back in `items[]`.

### Legacy single-shot RPCs
Simpler for one-off metadata edits — one typed call, no version bookkeeping. All take a row
lock, require `write` + an editable status, and bump `operation_version`.

| Method | Params |
|---|---|
| `$CR.create_cr_page` | `name`, `parent_key`, `title`, `slug?`, `is_group=0`, `is_published=1`, `content?`, `order_index?`, `is_external_link=0`, `external_url?`, `is_tab=0`, `tab_icon?`, `route?` → new `doc_key` |
| `$CR.update_cr_page` | `name`, `doc_key`, `fields{}` |
| `$CR.move_cr_page` | `name`, `doc_key`, `new_parent_key`, `new_order_index?` |
| `$CR.reorder_cr_children` | `name`, `parent_key`, `ordered_doc_keys[]` |
| `$CR.delete_cr_page` | `name`, `doc_key` |

## Lifecycle

```
Draft ──submit──▶ In Review ──approve──▶ Approved ──merge──▶ Merged (terminal)
  ▲                  │ │                                  
  │       withdraw ──┘ └──reject──▶ Rejected (terminal)
  │
  └── Changes Requested ◀── request_changes (from In Review or Approved)

Archived ◀── archive (from any status)
```

| Method | Params | Allowed from → to | Gate |
|---|---|---|---|
| `$CR.submit_change_request` | `name` | `{Draft, Changes Requested}` → `In Review` | `write`; throws unless `has_revision_changes` |
| `$CR.approve_change_request` | `name` | `{In Review}` → `Approved` | `_can_merge` |
| `$CR.request_changes` | `name`, `comment` (non-empty) | `{In Review, Approved}` → `Changes Requested` | `_can_merge` |
| `$CR.reject_change_request` | `name`, `comment` (non-empty) | `{In Review, Approved}` → `Rejected` | `_can_merge` |
| `$CR.withdraw_change_request` | `name` | `{In Review}` → `Draft` | owner or manager |
| `$CR.merge_change_request` | `name` | `{Approved}` → `Merged` | `_can_merge`; returns merge revision name |
| `$CR.archive_change_request` | `name` | any → `Archived` | `write`, no status guard |

Content is editable only in `Draft` and `Changes Requested` (`_EDITABLE_STATUSES`, enforced by
`_assert_editable` on every mutation).

Merge picks its path: `base_revision == space.main_revision` → `_fast_forward_merge`;
otherwise `_three_way_merge`.

## Merge conflicts

| Method | Params | Returns |
|---|---|---|
| `$CR.get_merge_conflicts` | `name` | Open conflicts: `[{name, doc_key, conflict_type, ours_payload, theirs_payload, ours_title, theirs_title, ours_content, theirs_content}]` |
| `$CR.resolve_merge_conflict` | `conflict_name`, `resolution` ∈ `"ours"`\|`"theirs"` | — |
| `$CR.retry_merge_after_resolution` | `name` | merge revision name; throws if any conflict is still Open |

### The orientation, at the source

`_three_way_merge`:

```python
base_items   = get_revision_item_map(cr.base_revision)
ours_items   = get_revision_item_map(space.main_revision)          # ALREADY LIVE
theirs_items = get_effective_revision_item_map(cr.head_revision)   # THE CHANGE REQUEST
```

Resolution is **whole-item** — there is no text-level merge — and there is **no rebase**:
`check_outdated` only sets a flag. Once main has moved, the only path forward is picking a
side per conflicting page.

`resolve_merge_conflict` refuses once the CR is `Merged` or `Archived`.

## Permissions

`wiki/permissions.py`:

- `MANAGER_ROLES = {"System Manager", "Wiki Manager"}`; `Administrator` short-circuits.
- Per-space ACL via `Wiki Space.roles` (Read \| Write). Write wins on duplicates.
- `can_read_space` — manager, or holds any listed role. **No role rows = open space =** any
  logged-in non-Guest user.
- `can_write_space` — manager, or a role listed at Write. On an open space, the global
  `Wiki Approver` role is the writer.
- `can_contribute_to_space` — read access AND (write-tier OR `allow_contributions`).
- `assert_space_writable` — hard-blocks all mutation on `git_synced` spaces.
- `_can_merge(wiki_space)` (`wiki_change_request.py:75`) is exactly `can_write_space`, and
  gates approve / request_changes / reject / merge / all conflict endpoints.

## Crawler rendering

Public `/<route>.md` and `llms.txt` go through the crawler renderer, which gates on
`can_read_space(space, "Guest")` — a private space 404s there even after a clean merge. Verify
against `Wiki Document` instead: `wikictl.py live <route>`.

## frappectl mechanics

- `frappectl -s "$SITE" method call <path> -F key=value` — `-F` typed scalar,
  `-F 'key:=<raw JSON>'` for nested lists/dicts, `-f` forces string.
- `-s` works before or after the subcommand.
- A genuine server throw exits 1; a `version_conflict` body exits 0.
- `frappectl api method/<path> -X POST --input -` takes the whole JSON body on stdin. This is
  the only safe channel for markdown, and the one `wikictl.py` uses for every call.
- `frappectl doc list -f 'route like …'` has returned nothing on Wiki Document; list with
  `--all` and filter locally.
