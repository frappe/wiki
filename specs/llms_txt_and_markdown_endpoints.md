# llms.txt, `.md` Page Endpoints, and Wiki Sitemap

Date: 2026-07-26
Status: **Implemented — all five phases landed.** Branch: `feat/llms-txt`.
Issue: [frappe/wiki#710](https://github.com/frappe/wiki/issues/710)

See [Reconciliation](#reconciliation) for where the build differs from the plan
below.

## Goal

Make a Frappe Wiki site legible to LLM crawlers and agents:

1. Serve every public page as raw markdown at `<route>.md`.
2. Publish an `/llms.txt` index per the [llmstxt.org](https://llmstxt.org/) spec —
   site-wide, plus one per Wiki Space.
3. Put wiki routes into `sitemap.xml`, where they are absent today.

Prior art is `frappe/llms_txt@b5f0e86` ("feat: autogen llms.txt"), a separate app
written against the **legacy v1 `Wiki Page` doctype**. It is dead against v3: it
queries `Wiki Page` / `Wiki Group Item`, gates on `allow_guest` (a field v3 does
not have), and routes spaces at `/llm/<space>.txt`. This spec re-does the same
idea natively on v3 with the current conventions.

## Current State (audited 2026-07-26)

### What already exists
- **`Accept: text/markdown` negotiation** —
  `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py:617-628`
  (`WikiDocumentRenderer.render`). Substring-matches the `Accept` header, gates
  on `check_space_access("read")` + `check_published()`, returns a bare werkzeug
  `Response` with `doc.content` and `Content-Type: text/markdown; charset=utf-8`.
  Tests: `test_wiki_document.py:1614-1721` (`TestMarkdownContentNegotiation`).
- **Content is already markdown.** `Wiki Document.content` is `Code` /
  `options: Markdown`. No ProseMirror JSON, no HTML→markdown converter needed.
- **Client-side markdown surface.** `templates/wiki/document.html:140` embeds
  `raw_markdown`; `:153-161` `copyMarkdown()`; `:198-207` `getAIUrl(provider)`
  builds ChatGPT/Claude/Perplexity deep links.
- **Reusable tree + tab helpers**, all cached and already used by the reader:
  `get_public_wiki_tree(root_group)` (`wiki_document.py:717`),
  `get_space_tabs(space)` (`:803`), `get_first_published_page(root_group)`
  (`:764`), `_first_published_leaf` (`:771`).

### Gaps
- No `.md` URLs — a crawler that cannot set request headers gets HTML only.
- Markdown branch returns bare `doc.content`: no title, no canonical URL, no
  `Vary: Accept` (so a shared cache can serve markdown to an HTML client).
- No `llms.txt` anywhere.
- **Wiki pages are missing from `sitemap.xml`.** Frappe's
  `frappe/www/sitemap.py` walks `get_public_pages_from_doctypes()`, which
  requires `has_web_view` + `allow_guest_to_view` + a published field.
  `Wiki Document` has none of these (it renders through a custom
  `page_renderer`), so no wiki route is ever listed.
- `Wiki Space` has **no `description` field** — nothing to put in an llms.txt
  blockquote.

### Access control (the constraint that shapes everything)
Guest visibility is **not** a DB flag. It is
`wiki/permissions.py:88 can_read_space(space, user)` — a space is public only if
its `roles` child table has a `Guest` row. A naive
`frappe.get_all("Wiki Space", {"is_published": 1})` in an llms.txt or sitemap
generator **leaks restricted routes**.

## Decisions

1. **`llms.txt` and `sitemap.xml` are always generated as `Guest`**, regardless
   of who requests them. They are crawler artefacts; a session-dependent body
   would be both a leak risk and uncacheable. Filter every space through
   `can_read_space(space, "Guest")`.
2. **`.md` responses follow the page's own permissions**, exactly like the HTML
   page — `check_space_access("read")` raises `DoesNotExistError` (404), so a
   restricted page is indistinguishable from a missing one.
3. **YAML frontmatter on markdown output** (title / description / space /
   canonical URL / updated), on both the `.md` route and the `Accept`-negotiated
   branch. One shared helper, so the two can't drift. This changes the existing
   exact-equality assertion in `test_accept_text_markdown_returns_raw_markdown`
   — that test gets updated.
4. **No internal-link rewriting.** The `llms_txt` app regex-rewrote
   `[x](/route)` → `[x](/route.md)`; the regex does not respect fenced code
   blocks and would corrupt documentation *about* markdown. `.md` is a
   convention crawlers already follow; the llms.txt index links to `.md`
   directly, which is where discovery actually happens.
5. **Space blockquote is derived, not a new field** — use the space's landing
   document's `meta_description`, falling back to a generated line. Avoids a
   schema change plus the backend/frontend field-sync work.
6. **A second `page_renderer`, registered first.** `hooks.py:20` becomes a list.
   Custom renderers run before `StaticPage`/`TemplatePage`
   (`frappe/website/path_resolver.py`), which is what lets us take over
   `/sitemap.xml`. The new renderer's `can_render` is a cheap suffix check, so
   normal page loads pay ~nothing.
7. **`llms-full.txt` is out of scope** for this PR (unbounded response size;
   revisit once per-space size is known).

## Endpoints

| Route | Body | Cache |
| ----- | ---- | ----- |
| `/<space>/<page>.md` | frontmatter + markdown | mirrors the HTML page; `private` when the space is not Guest-readable |
| `/<space>/<page>` + `Accept: text/markdown` | same as above | adds `Vary: Accept` |
| `/llms.txt` | site index of spaces | `public, max-age=3600`; Redis-cached body |
| `/<space>/llms.txt` | that space's page index | same |
| `/sitemap.xml` | wiki routes + framework pages | same |

`/<space>.md` and `/<group>.md` mirror the HTML behaviour: redirect to
`/<first-published-page>.md` via `get_first_published_page`.

## Output formats

### `<route>.md`

```
---
title: "Installing Frappe Wiki"
description: "Set up a wiki space in under five minutes."
space: "Developer Docs"
url: "https://docs.example.com/dev/install"
updated: "2026-07-24"
---

# Installing Frappe Wiki
...
```

Frontmatter values are serialised with `json.dumps` (a valid YAML string
subset), which escapes quotes/newlines correctly. The `llms_txt` app hand-rolled
`.replace('"', '\\"')` and breaks on newlines. Empty keys are omitted.

### `/llms.txt` (site)

```
# Example Docs

> Product documentation and guides.

Each space below links to its own llms.txt index. Append `.md` to any page
URL on this site to get that page's raw markdown source.

## Spaces

- [Developer Docs](https://docs.example.com/dev/llms.txt): APIs and internals
- [User Guide](https://docs.example.com/guide/llms.txt)
```

H1 from `Website Settings.app_name` (fall back to the site name); blockquote from
`Website Settings.description`.

### `/<space>/llms.txt`

llmstxt.org allows only a markdown list under each H2, so **one H2 per tab** and
a nested list mirroring the sidebar tree:

```
# Developer Docs

> APIs and internals for building on Frappe Wiki.

Append `.md` to any URL below for that page's raw markdown source.

## Home

- [Introduction](https://docs.example.com/dev/intro.md): What this is

## API Reference

- **Endpoints**
  - [Documents](https://docs.example.com/dev/api/documents.md)
  - [Spaces](https://docs.example.com/dev/api/spaces.md)
```

- Sections come from `get_space_tabs(space)`; top-level nodes with
  `is_tab` falsy go under the space's `home_tab_title` (default "Home"), matching
  `_home_tab_entry` (`wiki_document.py:890`).
- Tree from `get_public_wiki_tree(root_group)` — already pruned of empty groups
  and sorted by `sort_order`.
- A group has no page of its own, so it renders as an unlinked bold item —
  *unless* a published leaf sits at the group's route (the README/index case
  git-sync produces), in which case it is linked. Same rule as
  `_tab_landing_route` (`:782`).
- `: notes` suffix is the page's `meta_description`, omitted when empty.
- `is_external_link` nodes link to `external_url` with no `.md`.

### `/sitemap.xml`

Standard urlset. Includes:
- every published, non-group, non-external `Wiki Document` in a Guest-readable
  space, `lastmod` = `modified`;
- everything the framework sitemap would have emitted — `get_pages()` entries
  with `sitemap=1`, plus `get_public_pages_from_doctypes()` (imported from
  `frappe.www.sitemap`) — so overriding the route loses nothing.

`.md` variants are **not** listed (duplicate content).

## Implementation

### New files
- `wiki/wiki/llms_txt.py` — `build_site_llms_txt()`, `build_space_llms_txt(space)`,
  and the tree→markdown-list walker.
- `wiki/wiki/sitemap.py` — `build_sitemap_xml()`.
- `wiki/wiki/crawler_renderer.py` — `CrawlerRenderer(BaseRenderer)`.

### `WikiDocument.as_markdown()` (`wiki_document.py`)
Returns frontmatter + `self.content`. Called by both the `.md` route and the
`Accept` branch. Uses the existing `canonical_url` logic from
`get_web_context()` (`:453`) — `frappe.utils.get_url("/" + self.route)`.

### `CrawlerRenderer.can_render()`
In order, and each an early return:
1. `self.path == "llms.txt"` → site index.
2. `self.path.endswith("/llms.txt")` → strip suffix, resolve a published
   `Wiki Space` at that route; require `can_read_space(space, "Guest")`.
3. `self.path == "sitemap.xml"` → true only when at least one Guest-readable
   published space exists, so a wiki-less site keeps the framework sitemap.
4. `self.path.endswith(".md")` → **first** try the full path as a document route
   (a page could legitimately be slugged `foo.md`), then the stripped path;
   resolve exactly like `WikiDocumentRenderer.can_render` (`:594-598`), then the
   group/space redirect case (`:604-613`) pointing at `<first-page>.md`.
5. Otherwise false.

Returns raw werkzeug `Response` objects rather than `build_response`, matching
the existing markdown branch and `wiki/api/og_image.py:434` — `build_response`
attaches `X-Page-Name` and asset-preload headers that make no sense on plain
text.

### hooks.py
```python
page_renderer = [
	"wiki.wiki.crawler_renderer.CrawlerRenderer",
	"wiki.frappe_wiki.doctype.wiki_document.wiki_document.WikiDocumentRenderer",
]
```

### Caching + invalidation
`llms.txt` and `sitemap.xml` bodies go in Redis hashes (`wiki_llms_txt`,
`wiki_sitemap`), keyed by space route / `__site__`. Invalidate from the existing
write hooks — `on_wiki_document_update` (`:970`), `on_wiki_document_trash`
(`:1020`), `clear_wiki_tree_cache` (`:907`) — and add a `Wiki Space` `on_update`
hook, since space roles/publish state change the space list. Same invalidation
points already used for the sidebar tree, so there is nothing new to remember.

### Discovery
`templates/wiki/layout.html`, in `<head>` next to the canonical link (`:13-15`):
```html
<link rel="alternate" type="text/markdown" href="{{ canonical_url }}.md">
```

`robots.txt` is user-owned (`Website Settings.robots_txt`) — untouched. Document
that sites should add `Sitemap: https://<host>/sitemap.xml` there.

## Phases (tracer bullets)

1. **`.md` route + frontmatter.** `as_markdown()`, `CrawlerRenderer` with only
   the `.md` branch, hooks change, `Vary: Accept` + cache-control on the existing
   `Accept` branch. Smallest slice that works end to end.
2. **Per-space `/<space>/llms.txt`.**
3. **Site `/llms.txt`.**
4. **`/sitemap.xml`.**
5. **Caching/invalidation + `<link rel="alternate">`.**

Commit after each phase; reconcile this spec's status line as phases land.

## Tests

`test_wiki_document.py` (new `TestCrawlerEndpoints`, alongside the existing
`TestMarkdownContentNegotiation`), using the same `get_test_client()` +
`_make_request` harness (`:1595-1611`):

- `<route>.md` → 200, `text/markdown`, frontmatter title/url present, body ends
  with the source content.
- `<route>.md` on an unpublished page → 404.
- `<route>.md` in a space with no `Guest` role row, requested as Guest → 404.
- `<space>.md` → redirect to the first published page's `.md`.
- `Accept: text/markdown` → still markdown, now carries `Vary: Accept` and the
  frontmatter (**update** `test_accept_text_markdown_returns_raw_markdown`).
- `/llms.txt` → H1 + blockquote + `## Spaces`; a Guest-readable space is listed,
  a restricted one is not.
- `/<space>/llms.txt` → one H2 per tab, every page link ends in `.md`,
  unpublished pages absent, empty groups absent.
- `/sitemap.xml` → parses, contains published wiki routes, contains no route
  from a restricted space, contains no `.md` URL.

Per CLAUDE.md, the permission-leak cases get a **temp-revert check**: drop the
`can_read_space(..., "Guest")` filter and confirm the restricted-space tests
actually fail.

No e2e Playwright coverage — these are server-rendered plain-text responses with
no SPA surface.

## Verification

```bash
bench --site wiki.localhost run-tests --module \
  wiki.frappe_wiki.doctype.wiki_document.test_wiki_document

curl -s http://wiki.localhost:8000/llms.txt
curl -s http://wiki.localhost:8000/<space>/llms.txt
curl -s http://wiki.localhost:8000/<space>/<page>.md
curl -sI http://wiki.localhost:8000/<space>/<page> -H 'Accept: text/markdown' | grep -i vary
curl -s http://wiki.localhost:8000/sitemap.xml | xmllint --noout -
```

Then, logged out in a browser, confirm a restricted space appears in **none** of
the three index/markdown surfaces.

## Reconciliation

What the implementation does differently, and why.

1. **`.md` resolution order is reversed.** The spec tried the full path as a
   document route *first*, which would have made a page legitimately routed
   `foo.md` unreachable as HTML — its own URL would always serve markdown.
   `CrawlerRenderer._match_markdown` now bails when a document exists at the
   literal path (the reader keeps that URL), and only then strips the suffix.
   That page's markdown lives at `foo.md.md`. Covered by
   `test_page_routed_with_md_suffix_still_renders_html`.
2. **No blockquote fallback, and no site blockquote at all.** `Website Settings`
   has no `description` field (checked: it does not exist), so the site index
   opens with the H1 and the usage line only. A space's blockquote is its
   landing page's `meta_description` when set, and omitted otherwise — a
   generated "Documentation for X" line is noise in a file whose whole point is
   signal density. llmstxt.org makes the blockquote optional.
3. **An empty index does not 404 — the route is not claimed.** `can_render`
   builds the body and returns False when there is nothing to serve, so
   `/llms.txt` and `/sitemap.xml` fall through to whatever the site had there
   before. This is what keeps frappe's own sitemap working on a site with no
   public wiki, and it replaces the "at least one Guest-readable space exists"
   pre-check the spec described.
4. **One cache key, not two.** Both indexes live in a single Redis hash
   (`wiki_crawler_index`, in `wiki/wiki/crawler_cache.py`) keyed
   `llms-txt:__site__` / `llms-txt:<space>` / `sitemap`, and are dropped
   wholesale. Invalidation hangs off `clear_wiki_tree_cache` — which every
   document write already calls — plus new `Wiki Space` `on_update`/`on_trash`
   hooks, since a space's roles and publish state change the indexes without
   touching a document. A miss is cached as an empty string so a crawler
   hammering a dead route doesn't rebuild the answer each time.
5. **Spaces with a deleted root group are skipped.** Walking a dangling tree
   raises, and in an aggregate index one broken space would 500 the whole file.
   Found while testing (a leftover space on the dev site did exactly this);
   `test_site_llms_txt_survives_a_space_whose_root_group_is_gone` pins it.
6. **Content types.** `llms.txt` is `text/plain` so a browser shows it in-tab
   rather than downloading it; `sitemap.xml` is `application/xml`.
7. **`Vary: Accept` goes on the HTML response too**, not just the negotiated
   markdown one — the same URL has two representations, so every response from
   it has to say what picked this one.
8. **Group/space redirects check access first** (from review). The spec had the
   `.md` redirect mirror `WikiDocumentRenderer` exactly — but that path resolves
   and redirects *before* any permission check, so a restricted space's first
   page route came back in the `Location` header. Both renderers now go through
   `get_landing_page_for_route`, which gates on `can_read_space`. The reader's
   HTML redirect had the same pre-existing leak and is fixed here too: gating
   only `.md` would have left the identical route exposed one URL over.
9. **Index text is escaped** (from review). Titles and `meta_description` are
   editor-controlled free text: `]` in a title re-pointed a generated link, and
   a newline in a description opened new list entries. Labels escape their
   brackets, free text collapses to one line, external destinations are
   angle-bracketed.
10. **Cache-Control locally.** `frappe._dev_server` force-overwrites every
   response with `no-store` (`frappe/app.py:process_response`), so the curl
   checks below show `no-store` on a dev bench. The headers are asserted in the
   tests instead, where that override doesn't apply.

## Deferred

- `llms-full.txt` (per space and site-wide).
- Proper q-value `Accept` negotiation (today's substring match is good enough
  for the clients that send `text/markdown` at all).
- Per-page `robots` field / `noindex` (already backlogged in
  `specs/page_settings_meta_fields.md:114`).
- Retiring the standalone `frappe/llms_txt` app once docs.frappe.io is on v3.
