# Change Request Review: Rendered Page Diffs

Date: 2026-10-22
Status: **Draft spec**. Follows Part 3 of `edit_flow.md`, which lets every space reader open a submitted change request.

Prototype: [wiki-edit-flow](https://sketch.netchamp.dev/u/gajjug004/wiki-edit-flow#/change-requests/21), the change request page (`src/pages/ChangeRequest.vue`, `src/components/PageDiff.vue`, `src/lib/diff.ts`).

## Why

The review page answers "what does this change do to the wiki?" badly.

- Every page starts collapsed. A reviewer opens them one by one, and each opens with one request.
- The diff is the raw markdown (`DiffViewer`). A reviewer reads `**`, `:::` and table pipes, not the page readers will see. The Preview toggle shows both versions, but with nothing marked.
- The description is not shown. A rename shows only the new title.

The prototype shows every changed page at once, rendered as the reader renders it, with the changed blocks marked and the changed words inside them highlighted.

## Today

- `ContributionReview.vue` (`/change-requests/<name>`): page header with title, status, space, owner, assignees and the review actions. Below it, either the conflict list or the changes list.
- The changes list comes from `diff_change_request(name)` (summary). Expanding a row calls `diff_change_request(name, "page", doc_key)` for that page's base and head markdown, and shows `DiffViewer` (Diff) or two `WikiContentViewer`s (Preview). A reorder shows the old and new location instead.
- Part 2 (`edit_flow.md`) made the reader's content styles (`wiki-rendered.css`) and block scripts (mermaid, theme images) importable by the app.

## Design

### Page

Below the existing page header, as in the prototype:

- Status badge, title, author avatar and name, "opened <time> · <n> pages", then the description.
- "Changes" with "Show changes only" and a view switch: **Side by side**, **Inline**, **Markdown**.
- One card per changed page, all open. Card header: page icon, old title struck through and an arrow when the title changed, new title, change type badge, and a summary ("2 added, 1 edited").

The conflict list, the review actions and their dialogs stay as they are.

### Views

- **Side by side**: before on the left, after on the right, one row per block. A block only on one side leaves a hatched gap on the other. Added blocks are green, removed blocks red, edited blocks carry a red and a green edge with the changed words highlighted.
- **Inline**: one column. Removed blocks struck through, added blocks green, edited blocks show deleted words struck and added words highlighted.
- **Markdown**: the current `DiffViewer`. A rendered diff cannot show a changed link target or image source; the source can.
- **Show changes only** folds each run of unchanged blocks into "4 unchanged blocks".
- A page added or deleted has nothing to line up, so it always shows inline. A group or external link shows its header and description only. A reorder keeps today's old and new location.
- On a phone, Side by side falls back to Inline.

### Rendering and diffing

- The server renders both sides with the reader's `render_markdown` and `resolve_wiki_links`, so the diff looks like the published page and picks up `wiki-rendered.css`.
- The client splits each side into blocks: every top-level element, except that a list becomes one block per item, kept in its list so bullets, numbers and task boxes render.
- Blocks are lined up with a longest common subsequence on their HTML. A run of removed blocks next to a run of added ones is paired by position into edits.
- An edited pair of the same text tag (`p`, `h1` to `h6`, `li`, `pre`) gets a word diff over its HTML tokens. Each side renders only its own tokens, so its HTML stays as it was, links and bold included. Inline view uses the after side's markup and puts deleted words back in as plain text.
- Any other edited pair (table, callout, image, diagram) shows the whole block before and after. A diagram's text is its source, so word marks inside it would break the drawing.
- Mermaid diagrams and theme-aware images run through the reader's scripts.

### Data

New whitelisted GET `get_change_request_review(name)`: `check_permission("read")`, then `author` (`full_name`, `image`) and `pages`: for each changed page in the summary, in summary order, the summary fields and `base` and `head`, each with `title`, `content` and `html` (null when the side does not exist). A reorder also returns `location`, as the page scope does today. One request for the whole page instead of one per page. The review page had only the owner's user ID, and a contributor cannot read other users' names, so the author comes along.

`diff_change_request` stays for the agent skill and the conflict view.

## Decisions

1. **Rendered blocks, not markdown lines.** Reviewers read pages. Markdown stays one click away.
2. **Server HTML, client diff.** The server already renders exactly what readers see. The diff runs where the view switch and "Show changes only" live, and is a pure function the frontend tests cover.
3. **All pages open.** A change request touches a few pages. Collapsing them hid the change behind clicks.
4. **Pairing by position.** Simple and right for the common edit. A moved block shows as removed and added. A similarity score can come later.

## Tracer bullets

One PR against `develop`, stacked on Part 3.

1. `get_change_request_review` with unit tests: both sides rendered, rename keeps the old title, added and deleted pages have one side, a reader without access gets 403.
2. `lib/blockDiff.js` with node tests: line up, pair edits, word tokens, each side well formed, fold unchanged runs.
3. The page: header block, view switch, cards. Playwright: a change request that edits a paragraph, adds a section and renames a page shows the word highlights, the hatched gap and the old title; Inline and "Show changes only" work; Markdown shows the source diff.

## Not in scope

- Comments on a block.
- Moved block detection.
- Version history diffs (`edit_flow.md` Part 4). They should reuse this view.

## Progress

### 2026-10-22

Done:

- `get_change_request_review(name)` is a GET: the author's name and image, and every changed page with both sides as markdown and as reader HTML. `list_open_change_requests` and it share `_user_cards` for names and images.
- `lib/blockDiff.js`: `splitBlocks` (top-level elements, one block per list item kept in its list, numbering out of the key), `diffBlocks` (LCS on the key, removed and added runs paired by position), word tokens for `p`, `h1` to `h6`, `li` and `pre` (tags, entities, words, punctuation and spaces are separate tokens), `renderSide`, `renderInline`, `foldUnchanged`, `summarize`. Past 250,000 LCS cells an edited block shows whole.
- `PageDiff.vue` renders one card per page inside `.wiki-rendered`: Side by side with hatched gaps, Inline, or Markdown (`DiffViewer`, now without its own file header). Added and deleted pages always show inline; a reorder keeps the old and new location; a group or link shows its description. Mermaid draws through the reader's renderer; code blocks without word marks get syntax highlighting.
- `ContributionReview.vue`: status, title, author, time, page count, assignees and description at the top of the page; the view switch and "Show changes only"; every page open. A phone gets Inline and Markdown only. The conflict list and the review actions are unchanged.
- `DiffViewer` is loaded on demand. The review page chunk went from 448 KB to 27 KB (raw); the diff library loads only for Markdown or conflicts.
- `WikiContentViewer` had no other user after Preview went, and is deleted.
- The strip's "View changes" opened a "Pending Changes" dialog that listed the pages and showed none of the changes. It now saves unsaved edits and opens the review page, as in the prototype. The dialog is gone.

Fixed on the way: `renderMermaid` read each diagram's source after awaiting the loader, so a second call in the meantime took the same diagrams and fed the first call's drawn labels to Pele ("No diagram type detected"). It now claims the diagrams and reads their source before the await. The reader shares the module. `mermaidRenderer.test.js` fails without the fix.

Tests: `TestWikiChangeRequest` `test_change_request_review_renders_both_sides` and `test_change_request_review_refuses_an_outsider`. `blockDiff.test.js` (12) and `mermaidRenderer.test.js`. `e2e/tests/change-request-review.spec.ts`: word marks, the added section, the old title of a renamed page, Inline, "Show changes only" and Markdown. "View changes" lands on the review with an edit typed just before it; the test fails without the save. `change-request-flow`: the reorder test reads the new card; the Preview highlighting test now checks the review highlights code.
