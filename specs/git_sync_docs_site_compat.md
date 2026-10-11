# Git Sync: Docs Site Compatibility

Date: 2026-10-11
Status: **In progress.**

## Goal

Sync an existing docs-site repo (the Frappe Framework VitePress docs) into a git-synced space without changing its Markdown. The repo is the source of truth; the VitePress build goes away.

## Gaps found in the Frappe docs repo

- 382 links use the docs-site style: rooted at the docs folder, no extension (`[Reports](/desk/reports)`). The sync only rewrites file-relative `.md` links, so these stay as raw paths and break in the reader.
- Sidebar sections do not match folders ("App Lifecycle & Tooling" pulls pages from `server-side/`), so folder inference cannot reproduce the sidebar. An explicit config is needed.
- A config group's URL segment comes from its label, so "Tutorial (Build an App)" routes as `tutorial-build-an-app`, not `tutorial`.
- `.wiki.json` is noisy to hand-edit for ~100 pages and has no comments.

## Prior art

| Product | Sidebar config |
|---|---|
| GitBook | `SUMMARY.md` (Markdown list) |
| Mintlify | `docs.json` (JSON, part of the full site config) |
| Fern | `docs.yml` (YAML) |
| MkDocs | `nav:` in `mkdocs.yml` (YAML) |
| ReadMe | `_order.yaml` per folder |

Central YAML (Fern, MkDocs) fits best: comments, low noise, room for per-entry keys (`slug`, `autogenerate`). PyYAML is already used for front matter.

## Plan (tracer bullets)

### TB1 — Docs-site link resolution

`_rewrite_internal_links` also resolves:

- A leading `/` from the docs folder root (`/desk/reports` → `{docs_subdir}/desk/reports`).
- A path with no extension, a `.html` extension, or a trailing `/`: try `<path>.md`, `<path>.mdx`, then the folder's `index`/`README` landing. A file wins over a folder landing of the same name.

A link that matches no synced file stays unchanged, so links to site paths (`/api/...`) are not touched.

### TB2 — Optional group `slug` in the sidebar config

`{label, slug, items}` and `{label, slug, autogenerate}` use `slug` for the group's URL segment. Without `slug`, the label is used as before. Group identity (`source_path`) still uses the label chain, so adding `slug` re-routes a group but does not recreate it.

### TB3 — YAML sidebar config

The sync reads `.wiki.yml` or `.wiki.yaml` (YAML), or `.wiki.json` (JSON), from the docs folder. The schema is the same. More than one config file fails the sync with a clear error. Malformed YAML or a non-mapping fails the sync, like JSON today. Synthetic group `source_path`s keep the `.wiki.json#` prefix so that switching formats does not recreate groups.

## Progress

- [ ] TB1 — Docs-site link resolution
- [ ] TB2 — Group `slug`
- [ ] TB3 — YAML config
