# Callouts as container nodes + Alert-parity styling

## Problem

The callout block is an **atom** node (`callout-block.js:35`). Its body lives in a
`content` **string attribute**, so ProseMirror sees no editable content inside it.
To get bold/italic/links we hand-built:

- a second `Editor` instance per callout (`CalloutBlockView.vue:110-160`)
- a bespoke B / I / Link toolbar plus a link-URL input row
- `renderInlineMarkdown()` — a regex markdown renderer for view mode
- `wiki-editor-before-save` / `-after-save` DOM events to flush the sub-editor
  before the parent saves, plus a document-level `mousedown` click-outside handler

That reimplements the editor inside the editor, and still only supports three
marks. Lists, headings, code blocks, code spans and images inside a callout are
unreachable from the UI even though the **server renders them fine**
(`markdown.py:155` runs the inner markdown through `md.render`).

Separately the callouts are fully tinted (`surface-blue-2`, `surface-green-2`, …),
which no longer matches the frappe-ui `Alert` component: one neutral surface,
color only in the icon.

## Solution

Two independent changes, shipped in one branch.

### 1. Container node

TipTap's container pattern: a node with a **content expression** plus
`<NodeViewContent>` in the node view. The body becomes real content in the *main*
document — not a nested editor instance.

```js
// callout-block.js
content: 'block+',
isolating: true,
defining: true,
// atom: true  ← removed
```

```vue
<!-- CalloutBlockView.vue -->
<NodeViewWrapper class="callout callout-note">
  <div class="callout-header" contenteditable="false">…icon + title…</div>
  <NodeViewContent class="callout-content" />
</NodeViewWrapper>
```

Everything the main editor can do now works inside a callout for free: bold,
italic, links (incl. Cmd+K `WikiLink`), lists, task lists, headings, code blocks,
inline code, images, the bubble menu, the fixed menu, undo history, find, and
multi-block selection. `useDocumentOutline.js:20` already descends into block
containers, so headings inside a callout land in the TOC with no change.

Deleted: the sub-`Editor`, the toolbar, the link input, `renderInlineMarkdown()`,
`startEditing`/`finishEditing`/`syncSubEditorContent`, both save-event listeners
and the click-outside handler.

### 2. Alert-parity styling

Match `frappe-ui/src/components/Alert/Alert.vue` (banner layout) exactly:

| | value |
|---|---|
| container | `rounded-6` (12px), `bg-surface-gray-1`, `p-3`, no border |
| icon | `size-4` (16px), solid Figma status glyph |
| header gap | `gap-1.5` (6px), icon and title vertically centred |
| title | `text-base-medium` (14px/500), `text-ink-gray-8` |
| body | `text-p-base` (14px, lh 1.5, ls 0.02em), `text-ink-gray-6`, `mt-1` (4px), full width — **not** indented under the title |

Icon per type — the exact `solidStatusIcons` map from
`frappe-ui/src/components/shared/statusIcon.ts`:

| type | theme | glyph | color |
|---|---|---|---|
| `note` | blue | `AlertCircleSolidIcon` | `--ink-blue-5` |
| `tip` | green | `SuccessSolidIcon` | `--ink-green-5` |
| `caution` | amber | `AlertTriangleSolidIcon` | `--ink-amber-5` |
| `danger` | red | `CloseCircleSolidIcon` | `--ink-red-5` |

Those four SFCs are **not exported** from `frappe-ui/icons` (only `DownSolidIcon`
is; see the note in `statusIcon.ts`), so the `viewBox="0 0 16 16"` paths get
inlined — in the Vue node view and in `markdown.py`'s `CALLOUT_ICONS`, the same
way the current lucide paths are.

Title editing moves from the ⋯ → dialog into a **borderless inline input** in the
header row, placeholder = the type's default title. The dialog is deleted.

## Wire format & data migration

**None.** `:::note[Title]\n…\n:::` is unchanged, and markdown is the only
persisted form — nothing in `frontend/src` calls `editor.getJSON()`. Existing
pages parse straight into the new container node.

Markdown hooks in `callout-markdown.js` change from string-shuttling to child
nodes:

- `tokenize(src, tokens, lexer)` — the third argument is a
  `MarkdownLexerConfiguration`; `lexer.blockTokens(inner)` tokenizes the fence body.
- `parseCalloutMarkdown(token, h)` — `h.parseBlockChildren(token.tokens)` builds
  the child nodes (`parseBlockChildren`, not `parseChildren`, so `PreserveBlankLines`
  keeps authored blank lines).
- `renderCalloutMarkdown(node, h)` — `h.renderChildren(node.content, '\n\n')`
  between the fences. **Still no trailing separator** — the reason is documented
  at `callout-markdown.js:59-65` and the regression test guards it.

## Rendering surfaces

Four places draw a callout; three are live, one looks dead:

1. **Editor** — `CalloutBlockView.vue` (also used read-only by
   `WikiContentViewer.vue:72`).
2. **Public reader** — `markdown.py:_generate_callout_html` +
   `wiki/public/css/main.css:266-380`. Its icon colors are also *wrong* today
   (`--ink-blue-2` where the SPA uses `-5`) — fixed by this restyle.
3. **Print format** — `standard_wiki_document.html:99-170` (hard-coded hex, no
   token vars available; float-based icon layout).
4. **`frontend/src/wiki-rendered.css:70-132`** — nothing in the repo carries a
   `.wiki-rendered` class; only `index.css:7` imports the file. Verify, then
   delete the callout rules (or the file) rather than restyling dead CSS.

Server HTML gets the Alert structure — header row, then full-width body:

```html
<aside class="callout callout-note">
  <div class="callout-header">
    <span class="callout-icon">…svg…</span>
    <span class="callout-title">Note</span>
  </div>
  <div class="callout-content">…rendered inner markdown…</div>
</aside>
```

The `.callout-body` wrapper and the `grid-template-columns: auto 1fr` layout go
away — the body is no longer indented under the title. `parseHTML` in
`callout-block.js:53` switches from scraping `.callout-content` text to
`contentElement: '.callout-content'` so pasted/rendered HTML round-trips.

Public CSS token equivalents (all present in
`wiki/public/css/frappe-ui-tokens.css`): `--surface-gray-1`, `--radius-6` (12px),
`--ink-gray-8`, `--ink-gray-6`, `--ink-{blue,green,amber,red}-5`.

## Keyboard & editing behaviour

- Cursor exits the callout with ArrowDown/ArrowRight at the end (add a trailing
  paragraph when the callout is the last node).
- `Mod-Enter` exits the callout and opens a paragraph after it.
- Backspace at the very start of an empty callout deletes the node.
- `isolating: true` stops Backspace/Delete from lifting content across the border.

## Known limitation

`content: 'block+'` permits a callout inside a callout, which the `:::` fence
cannot represent (both the backend regex and the tokenizer close at the first
`:::`). Nesting is blocked where it can be initiated — the slash-menu commands and
`setCallout` no-op when `editor.isActive('calloutBlock')`. A callout dragged into a
callout is an accepted, unguarded edge.

## Phases (tracer bullets)

Each phase ends in a commit; the spec is committed first.

**Phase 0 — spec**
Stays on `feat/frappe-ui-beta55` — no new branch. The Alert tokens (`rounded-6`,
`text-p-base`, `surface-gray-1`) come with the beta55 upgrade, so the work belongs
on that branch anyway. Commit this file alone. Other sessions are dirtying this
checkout: stage by explicit path, never by directory.

**Phase 1 — schema flip (the tracer)**
`callout-block.js` → `content: 'block+'`; `CalloutBlockView.vue` → `NodeViewContent`,
old sub-editor machinery deleted; `callout-markdown.js` → child parse/render.
Keep the old colored styling untouched. Done when: type into a callout, `Cmd+B`
via the main bubble menu, save, reload, and the markdown is byte-identical to what
the old editor produced.

**Phase 2 — node view UX**
Inline title input, ⋯ menu (type switch + delete, title dialog removed), the
keyboard rules above, empty-callout placeholder.

**Phase 3 — editor restyle**
Alert parity in `CalloutBlockView.vue`: neutral surface, inlined solid glyphs,
`rounded-6`/`p-3`, header/body typography. `yarn build` from `frontend/`.

**Phase 4 — public + print restyle**
`markdown.py` (icons + `callout-header` structure), `main.css` (neutral surface,
`-5` icon inks, remove the grid layout), print format (Alert layout, hex resolved
from `colors.json`), delete the dead `wiki-rendered.css` callout rules.
`yarn tailwind:build`.

**Phase 5 — tests**
- `callout-markdown.test.js`: container round-trip — inline marks, a bullet list,
  a code block, a heading, blank lines between paragraphs; keep the
  no-trailing-separator regression case.
- `test_markdown.py`: new HTML structure + new icon paths.
- `e2e/tests/callout-rich-text.spec.ts`: rewritten — the sub-editor and its
  toolbar no longer exist. Types into the callout, formats with the main
  toolbar/shortcut, asserts the markdown and the rendered DOM.
- `slash-menu.spec.ts`: unchanged insert paths still pass.

## Reconciliation log

**Phase 0** — `2dfc31c`. Spec committed. Stayed on `feat/frappe-ui-beta55` per the
user; no new branch.

**Phase 1** — `8bdc45e`. Schema flipped, markdown hooks rewritten, node view cut
from 332 lines of sub-editor machinery to a `NodeViewContent` hole
(−370/+163 across the five files). Deviations from the plan, all deliberate:

- `parseBlockChildren` → `parseChildren`. Matches TipTap's own
  `createBlockMarkdownSpec`; the blank-line preservation `parseBlockChildren`
  adds is for the top level, and inside a fence it only risks phantom paragraphs.
- Nesting guard landed here rather than later: `setCallout` returns false when
  the cursor is already in a callout, and the four slash commands now go through
  it instead of raw `insertContent` (they were also still passing the dead
  `content: ''` attribute).
- The e2e spec was rewritten now, not in Phase 5 — it asserted the sub-editor and
  its toolbar exist, so it could not survive the schema flip. Five specs pass
  against `wiki.localhost:8000`.
- The ⋯ menu is now hidden when `editor.isEditable` is false. It was rendering in
  the read-only `WikiContentViewer` on hover.

Worth recording: **a markdown fixed point proves nothing about fidelity.** The
first version of the code-block case round-tripped perfectly while the fence
collapsed to a bare text node — the unit harness had no `codeBlock` registered
(`wikiStarterKit` disables it for frappe-ui's version, whose .vue view
`node --test` can't load). The harness now registers the plain
`@tiptap/extension-code-block`, and there is an explicit assertion on the parsed
child node types.

**Phase 2** — `fe6f104`. Inline title input (Enter moves into the body), ⋯ menu
without the title dialog, and the exits: `Mod-Enter` / `ArrowDown`-at-the-end open
a paragraph after the callout, Backspace at the start of an empty one deletes it.
The Placeholder config is now a function so an empty callout body reads as a
callout rather than as an empty document.

The e2e spec also stopped authoring into "whichever space is listed first". That
space's tree grows every run and was never cleaned up, which is what made the
suite flake locally — each test now creates a throwaway space through the API and
`afterEach` deletes it.

**Phase 3** — `9631c12`. Alert parity in the editor, verified by screenshot. One
correction after looking at it: the title placeholder was inked `ink-gray-4`, so
an untitled callout showed a grey "Note" in the editor and a full-ink "Note" once
published. The placeholder is inked like a typed title now — an empty title is not
an empty header.

**Phase 4** — `01a03e3`. `markdown.py` emits the header/body structure with the
Alert glyphs; `main.css` and the print format follow. Verified by screenshotting a
published page: it matches the editor. Two things found on the way:

- The public icons were a shade off before this — `--ink-blue-2` etc. where the
  SPA used `-5`. Nobody had noticed because the tinted surface hid it.
- `wiki-rendered.css` is dead in full, not just its callout rules: its only
  consumer, the standalone CR preview page, was removed in `afb6808`. Only the
  callout rules are removed here — `specs/cleanup/` suggests another session is
  already working through dead code, and this is theirs to take.

Print is the one surface not visually verified; it has no CSS variables and needs
a wkhtmltopdf run. Its structure follows the same class names `markdown.py` emits.

**Phase 5** — tests landed with the phases they cover rather than in a batch at
the end. Final state: 15 markdown unit tests, 81 python tests in
`test_markdown.py` (two new: HTML structure, and the icon paths), and 9 e2e specs
covering parse fidelity, typing with the main toolbar, the slash insert, the
title input, both exits, and the published page. `slash-menu`, `editor-toc` and
`public-blank-lines` pass unchanged.
