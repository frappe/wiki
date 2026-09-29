# Internal Page Links

Date: 2026-09-28
Status: **Implemented** (2026-09-28). Backend, frontend unit and e2e tests green locally.
Issue: [frappe/wiki#814](https://github.com/frappe/wiki/issues/814), "Internal Linking between pages"
Ref: [discuss.frappe.io thread](https://discuss.frappe.io/t/frappe-wiki-link-to-pages-using-internal-page-id-instead-of-route)

## Goal

Authors link to other pages by pasting the page's route today. When a page is moved or its route is edited, every link to it breaks. Let authors link to a page by identity so the link follows the page.

## Decisions

- **Stored as a standard markdown link to the page's `doc_key`:** `[Setup Guide](wiki:a1b2c3d4e5f6)`. `doc_key` is already the immutable page identity (set once in `WikiDocument.set_doc_key`, used by change requests and the SPA). Standard markdown keeps git sync, `.md` output and the tiptap link mark working unchanged. The label is ordinary link text, so a title rename does not break the link either.
- **Authoring is Obsidian style:** typing `[[` in the editor, or picking "Link to Page" from the `/` menu, opens a page picker. Picking a page inserts the link with the page title as its label.
- **Same space only.** The picker lists pages from the space tree the editor already has (`SPACE_TREE_KEY`), draft pages included.
- **Resolved at read time, after the render cache.** `render_markdown` emits an internal link as `<a data-wiki-link="<key>">`, with no route. Each read swaps in the current route with one query, which runs only when the page has such links. So moves, route edits, space route rewrites and deletes need no extra cache invalidation.
  - Considered and rejected: resolving inside markdown.py, before the cache. That removes the per-view query, but the cache would then hold routes. Every write path that changes a route would have to clear it, including the raw-SQL space route rewrite, and there is no backlink index to clear only the pages that link to the changed one.
- **A link to a page that is not live** (deleted, unpublished, or still in an unmerged change request) renders as its plain label, not a dead link.

## Plan (tracer bullets)

1. **Backend resolve.** markdown.py renders `wiki:` links as `data-wiki-link`, and `resolve_wiki_links(html)` in `wiki_document.py` fills in the route. It is applied to the web render (`get_web_context`) and the PDF render (`before_print`). Unit tests cover a moved route, an unpublished target, and a page with no links.
2. **Editor picker.** A `[[` suggestion (`page-links.js`) opens its own popup (`PageLinkList.vue`) and inserts a `wiki:` link.
3. **Editor display.** In the editor, `wiki:` links open the target page in the SPA on Cmd/Ctrl-click, and the link popup shows the page title instead of the raw key.
4. **E2E test** for the `[[` flow.

## Out of scope

- Cross-space links.
- Rewriting `wiki:` links to URLs in the `.md` / `llms.txt` output. Add this if agents need resolved links.
- Backlinks ("pages linking here").

## Progress

- **Phase 1, backend resolve.** The `link_open` render rule in markdown.py turns `href="wiki:<key>"` into `data-wiki-link="<key>"`, so the resolver matches an attribute the renderer controls rather than guessing at `href`. `TestInternalLinkRendering` covers it. `resolve_wiki_links` runs after `get_rendered_content` in `get_web_context`, and after `render_markdown` in `before_print`. `TestInternalPageLinks` covers resolve, route change, unpublished target, unknown key, and no lookup for pages without links. Four of the five fail with the resolver turned off.
- **Phase 2, editor picker.** `page-links.js` adds the `[[` suggestion. WikiEditor's slash-menu popup code became `createSuggestionMenu(suggestion, menu, menuProps)` and mounts either menu component in the same tippy popup. The open page is left out of the picker. `page-links.test.js` covers listing, filtering and the markdown round-trip.
- **Phase 3, editor display.** `LinkPopup` shows the page title with a file icon for `wiki:` links, and Edit then Save keeps `wiki:` as it is (no `https://` prefix). Cmd/Ctrl-click opens the target's editor URL through a new `resolveHref` option on `WikiLink`.
- **Phase 3b, retarget with Backspace.** Backspace inside or at the end of a page link turns the whole link back into `[[Title`, which reopens the picker. Inside counts too, because Chrome's ArrowLeft steps over a link's end. The handler reads the caret from the DOM (`posAtDOM`), because Chrome reports arrow-key moves through an async `selectionchange` and `state.selection` can be stale on a quick Backspace. That lag made the first e2e version flaky. When a link is picked, the picker reuses a space that already follows it instead of adding a second one.
- **Phase 3c, slash command.** "Link to Page" in the `/` menu (keyword `linkpage`) inserts `[[`, which opens the same picker.
- **Phase 3d, picker styled after the wiki-proto Sketch prototype** (`WikiLinkLayer.vue` in nagariahussain/wiki-proto). `PageLinkList.vue` is a port of its popup:
  - a "Link to a page" header that becomes "Link to “query”" once you type;
  - two-line rows: the title with the matched part bold, and the folder trail below it (the space name for a top-level page);
  - an "Unpublished" tag, and a ↵ icon on the selected row;
  - a key-hint footer, and 340px width.

  `rankPages` ports the proto's ranking: title prefix, then word start, then substring, with a scattered-letter fallback only when nothing contains the query, and at most 8 rows.
- **Phase 3e, the rest of the proto.**
  - **Create row.** "Create “query”" shows when no page has that name, the open page included. Picking it inserts the title at once and creates a draft page in the open page's folder (`draftStore.createNode`). The link mark goes on only after the create returns the real `doc_key`, because a `tmp_*` key saved into content would point nowhere.
  - **Typed `[[Exact Title]]`.** An input rule links a title that matches a page exactly, ignoring case.
  - **Page glyph.** `wiki:` links in the editor show a page glyph and a soft underline, from the proto's CSS, in `wiki-editor-content.css`.
- **Phase 4, e2e.** `e2e/tests/internal-page-links.spec.ts` picks a page with `[[`, merges, checks the published href, changes the target's route, and checks the href again. A second test retargets a link in the middle of a sentence with Backspace. Both passed 6 repeat runs each. A third test covers `/linkpage`, and two more cover the typed `[[Title]]` and the Create row. All five passed 3 repeat runs.
- **Fixed along the way:** the link popup's Remove icon was `lucide-link-2off`, which renders nothing, so it is now `lucide-link-2-off`.
- **Review fixes (Greptile on #817).**
  - `resolve_wiki_links` now resolves only pages in the linking page's own space. Access is granted per space, so a hand-typed key to a page in a restricted space no longer puts that page's route into the HTML.
  - Create-and-link maps the title's range through every edit made while the create is pending, so typing before the title no longer drops the link.
  - Both have a regression test that failed before the fix.
