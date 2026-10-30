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

## Progress

- [x] `LocalFolder`, `sync_space(folder=...)`, `preview_local_docs`, the `wiki preview-docs` command and the `Local` sync log trigger.
- [x] Unit tests: the folder tree and blob hashes, a new space, reuse and the "No Change" skip, refusal of a space that is not synced, refusal without developer mode. `_FakeRepo.install` now restores the real fetch functions after each test, so later tests do not read a fake repo.
