# Published Pages Honour Author Blank Lines

Date: 2026-07-28
Status: In progress. Lives on `fix/published-blank-line-spacing`.

## Problem

Wiki content is stored as markdown. The `prose-v3` scale used by both surfaces sets `p { margin: 0 }` on purpose — vertical rhythm is author-controlled via blank lines (frappe-ui `tailwind/plugin.js:442-456`).

The editor honours that: `@tiptap/markdown` materialises extra blank lines as empty paragraphs, and `WikiParagraph` (`frontend/src/components/WikiEditor.vue:85-94`) serialises them back to bare blank lines. The server renderer does not — `wiki/wiki/markdown.py` runs markdown-it-py CommonMark, which discards blank-line runs. With zero `p` margins and nothing replacing them, **published pages render every block flush against the next**, while the editor shows the spacing the author typed.

Related asymmetry fixed in the same change: the editor parses with `marked({ breaks: true })` (single newline → `<br>`); the server had `breaks` off.

## Approach

Preserve blank lines server-side, at token level, mirroring the editor's arithmetic. No storage-format change, no CSS-margin workaround (that would break the prose-v3 contract and still ignore author intent).

Gap formula, verified against `marked`'s `space` token raw + `@tiptap/markdown`'s `createImplicitEmptyParagraphsFromSpace`: for a gap of `g` blank lines between two top-level blocks → `(g + 1) // 2 - 1` empty paragraphs (g=1,2 → 0; g=3,4 → 1; g=5 → 2). At document start → `g // 2`.

The formula applies **uniformly**, regardless of the preceding block type. `marked` swallows trailing newlines after headings/tables/HTML blocks/indented code/callouts, so the editor shows no gap there — but the blank lines *are* in the stored markdown. Rendering what the markdown says is stable across upstream tokenizer changes and self-heals on the next editor save. `_GAP_SUPPRESSING_PREV_BLOCKS` is the one-line switch if that call ever flips.

## Changes

1. **`wiki/wiki/markdown.py` — gap-preserving placeholders.** The callout/video/PDF replacers returned `f"\n\n{PH}\n\n"`, inflating every adjacent gap by two newlines; with the new rule that would render a phantom blank paragraph on each side of every callout, video and PDF. `_standalone_block()` now emits only the newlines needed for the placeholder to stand alone as a block.
2. **`wiki/wiki/markdown.py` — blank-line rule.** `_blank_line_rule` (core rule, registered `after("block")`) inserts a `wiki_blank_line` token before each top-level block for the author's extra blank lines; `_render_blank_line` emits `<p class="wiki-blank-line" aria-hidden="true"><br></p>` (a bare `<p></p>` collapses to zero height under `margin: 0`).
   - Gaps are measured by scanning `state.src` backwards from `token.map[0] - 1`, never from the previous token's `map[1]`: markdown-it folds trailing blank lines into a list's map, so `map[1]` under-reports.
   - `after("block")` is load-bearing — after `normalize` (CRLF collapsed, so `src.split("\n")` matches the maps) and before the footnote plugin's `footnote_tail`, which reorders tokens.
3. **`wiki/wiki/markdown.py` — `breaks: True`** on the MarkdownIt instance, matching the editor's `marked` config.
4. **`wiki/public/css/main.css`** — `.prose .wiki-blank-line { line-height: 20px }`, matching the SPA read-only viewer's empty-paragraph height.
5. **`wiki/patches.txt`** — explicit `clear_wiki_content_cache()` post-model-sync, since `get_rendered_content` Redis-caches rendered HTML per document and only evicts on save/merge/trash.

## Out of scope (documented divergences)

- Blank lines nested inside list items / blockquotes — markdown-it exposes no container-relative line map. The editor materialises some of these.
- Trailing blank lines at end of document — every git-synced `.md` ending in `\n\n` would otherwise gain a dead band above the prev/next nav.
- Blank lines *inside* callout bodies now render too (`_replace_callout_placeholders` re-renders the body through `md.render`) — intended.

## Tests

- `wiki/wiki/test_markdown.py::TestBlankLinePreservation` — gap counts, block types (list/blockquote/table/fence/hr/heading/html), fence interiors untouched, placeholder gaps (regression guard for change 1), leading vs trailing boundaries, TOC unaffected, footnotes, soft breaks.
- `e2e/tests/public-blank-lines.spec.ts` — published page renders the gaps with real height; the Python tests can prove the markup, only the browser can prove the pixels.
