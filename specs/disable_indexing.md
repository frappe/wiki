# Disable Indexing (per page)

Date: 2026-09-24
Issue: https://github.com/frappe/wiki/issues/806
Status: **Phase 1 implemented.** Phase 2 pending.

## Goal

Let an editor keep a page out of search engines while it stays published and
readable. Same idea as Frappe Builder's "Disable Indexing".

## Prior art: Frappe Builder

- `Builder Page.disable_indexing` (Check, "Prevent search engines from indexing
  this page").
- `get_context` sets `context.disable_indexing = self.disable_indexing or self.staging`.
- `templates/generators/webpage.html` emits
  `<meta name="robots" content="noindex, nofollow">` when it is set.
- A change to the field clears the route cache.
- A Switch in the page settings sidebar (`PageGeneral.vue`).
- The sitemap is **not** filtered. A noindex page stays listed there.

## Current state (wiki)

- Public head: `templates/wiki/layout.html`. It has metatags, canonical and
  JSON-LD, but no robots tag.
- Crawler surfaces: `sitemap.xml` (`wiki/wiki/sitemap.py`), `llms.txt`
  (`wiki/wiki/llms_txt.py`) and `<route>.md` (`wiki/wiki/crawler_renderer.py`).
  The sitemap and llms.txt are cached whole in `crawler_cache`. Every Wiki
  Document update drops that cache through `clear_wiki_tree_cache`.
- Page settings live in `PageSettingsPanel.vue`. Meta fields are written
  straight to the document with `docResource.setValue`, outside the change
  request flow.

## Decisions

1. **One field, `disable_indexing`, on Wiki Document.** Same name as Builder.
   It sits in the Meta Tags section.
2. **Pages only, no inheritance.** A page is hidden only when its own flag
   is set. The field is hidden on groups in Desk
   (`depends_on: eval:!doc.is_group`), so a section cannot be flagged
   anywhere. See "Out of scope".
3. **`noindex`, not `noindex, nofollow`.** A hidden page's sidebar links to
   pages that should still be crawled. Builder pages are standalone, so
   nofollow costs Builder nothing. Here it would cut crawl paths.
4. **Hidden pages leave the sitemap.** Builder keeps them listed, which sends
   Google mixed signals ("crawl this" and "do not index this"). We drop them.
5. **Written directly, not through a change request.** Like the meta fields,
   it changes no reader-visible content. It is also wiki-side data that git
   sync never writes, so it stays editable on a git-synced page.
6. **Site search is untouched.** The flag is about external search engines.
   The wiki's own search still finds the page.

## Phases

### Phase 1: tracer bullet (done)

Field to reader head to sitemap to UI, for a single page.

- `disable_indexing` Check field on Wiki Document, hidden on groups.
- `get_web_context` passes `disable_indexing`, and `layout.html` emits
  `<meta name="robots" content="noindex">`.
- `get_noindex_documents()` returns every hidden page name, and
  `sitemap.py` skips them.
- `PageSettingsPanel.vue`: a "Disable Indexing" switch in General,
  saved with the meta fields.
- Unit tests: head tag present for a flagged page, absent otherwise;
  sitemap excludes it.
- Playwright e2e: flip the switch, check the page head and the sitemap as
  Guest, then flip it back.

### Phase 2: other crawler surfaces

- `llms.txt`: leave hidden pages out of the space index through
  `get_noindex_documents()`, and drop the groups they leave empty.
- `<route>.md`: send `X-Robots-Tag: noindex` for a hidden page, so the
  markdown twin cannot be indexed in place of the HTML page.
- The site `llms.txt` drops a space whose own index would be empty, so it
  never links to a 404.

## Out of scope

- Sections. Hiding a group and everything under it is left for later, on
  the maintainer's call. If it comes, flagging a group should hide every
  page under it, including pages added later.
- Editing `robots.txt`. Website Settings already has it.
- Hiding unpublished or restricted pages. They are not served to Guest, so
  there is nothing to index.

## Progress log

- 2026-09-24: Spec written. Phase 1 implemented. `TestDisableIndexing`
  (2 tests) passes and fails when `get_noindex_documents()` returns an
  empty set. The e2e `disable-indexing.spec.ts` passes on wiki.localhost:
  the switch saves, the flagged page's head has `noindex`, its sibling's
  does not, and the page leaves the sitemap.
