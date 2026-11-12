# Local Docs Preview

Status: **Done.**

## Goal

Let a docs author see a Git-synced docs folder in the wiki before they push. Today the only way is to push a branch and sync, which is slow, needs a public branch, and uses the GitHub API rate limit.

## Decision

A dev-only bench command syncs a folder on disk through the same engine as GitHub Sync:

```sh
bench --site wiki.localhost wiki preview-docs apps/wiki/docs --route docs --watch
```

- **One engine.** `LocalFolder` reads the folder the way the sync reads a GitHub tree: the same tree entries, and git's blob hash as the SHA. The four `_fetch_*` functions use it when they get a `LocalFolder` instead of a repo name. `sync_space(..., folder=...)` runs everything else unchanged: `.wiki.yml`, front matter, link and image rewriting, the sync log, and the "No Change" skip.
- **Its own space.** `--route` names the preview space. The command reuses the git-synced space at that route, creates one when the route is free, and refuses a space that is not git-synced, so it never replaces handwritten pages.
- **Developer mode only.** `preview_local_docs` refuses to run without `developer_mode`.
- **Watch.** `--watch` compares the size and modification time of every file once a second and syncs again on a change. A sync writes a `Local` entry to the Wiki Git Sync Log.
- Hidden folders such as `.git` are skipped. Hidden files such as `.wiki.yml` are read.

## Reader live reload

In developer mode, a reader page of a git-synced space reloads itself after the next sync, so `--watch` shows each save in the open tab.

- The page context gets `live_reload` (the space and its `last_synced_commit_sha`) only in developer mode and only for a git-synced space. Otherwise the page has no script.
- The page polls `wiki.api.wiki_space.get_sync_sha` once a second while the tab is visible, and reloads when the SHA changes. The endpoint answers only in developer mode and only to users who can read the space.
- Polling, not realtime: the reader loads no realtime client, and a poll works the same for guests and signed-in users.

## Progress

- [x] `LocalFolder`, `sync_space(folder=...)`, `preview_local_docs`, the `wiki preview-docs` command and the `Local` sync log trigger.
- [x] Unit tests: the folder tree and blob hashes, a new space, reuse and the "No Change" skip, refusal of a space that is not synced, refusal without developer mode. `_FakeRepo.install` now restores the real fetch functions after each test, so later tests do not read a fake repo.
- [x] Reader live reload: `get_live_reload` context, `live_reload.html`, `get_sync_sha`. Unit tests for the context and for the endpoint (developer mode, synced space, guest on a private space).
