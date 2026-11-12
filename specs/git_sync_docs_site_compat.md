# Git Sync: Docs Site Compatibility

Date: 2026-10-11
Status: **Implemented.**

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

### TB4 — Do not repeat the page title

The reader shows the page title above the content, and docs pages also start with `# Title`, so the title shows twice. During sync, a leading H1 that equals the page title is removed from the content. A heading-only page keeps its H1, because an empty page gets placeholder content.

## Progress

- [x] TB1 — Docs-site link resolution: `get_link_targets` adds stem and folder aliases once per sync; `/`-rooted links resolve from the docs folder; `.html` is stripped. Unit test temp-revert verified.
- [x] TB2 — Group `slug`: `add_group` and labelled `autogenerate` take an optional `slug`; identity still uses the label chain. Unit test temp-revert verified.
- [x] TB3 — YAML config: `load_wiki_config` reads `.wiki.yml`, `.wiki.yaml` or `.wiki.json` and fails on more than one. The settings preview stays JSON (the `wiki_config` Code field). Unit tests temp-revert verified.
- [x] TB4 — Do not repeat the page title: `strip_title_heading` runs for every node in `_sync_to_live`. Unit and sync tests, temp-revert verified.
