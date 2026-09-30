# Editor Typing Performance

## Problem

On one production page, keystrokes appeared 2–3 seconds late. The page had
12 images. Two of them were inline `data:image/png;base64,…` URIs of about
1.5 MB each, so the page markdown was 3 MB for a 6 KB document.

Measured in the browser on that page:

| Step | Time |
| --- | --- |
| `editor.getMarkdown()` | 2.3 ms |
| `editor.markdown.parse(md)` | 224 ms |

Each keystroke ran `handleContentChange`, which did three markdown parses
synchronously (about 670 ms of blocked main thread per keystroke).

## Causes

1. **Pasted HTML keeps base64 images.** `handlePaste` uploads clipboard
   *files* only. HTML from Google Docs, Notion or a web page can carry
   `<img src="data:…">` with no file item. ProseMirror inserts it as-is and
   the base64 is saved in the content.
2. **Tokenizers pile up on the global `marked`.** `@tiptap/markdown` uses the
   global `marked` singleton unless it gets an instance. Each
   `MarkdownManager` calls `marked.use()` to register the custom tokenizers.
   Each `WikiEditor` mount (one per opened page) and each
   `WikiContentViewer` adds another full set that is never removed. In Node,
   parse time grows linearly: 1 manager → 22 ms, 20 managers → 168 ms on the
   same 3 MB input.
3. **Full parses on the keystroke path.** `handleContentChange` canonicalizes
   the editor markdown (serialize → parse → serialize) twice and
   canonicalizes `savedContent` once, on every transaction.

## Solution

### Phase 1: Upload base64 images on paste

- In `handlePaste`, when the pasted HTML has `<img src="data:image/…">`,
  let ProseMirror insert the slice, then upload each data-URI image through
  the same path as file pastes (`uploadFile`) and swap `src` to the file URL.
- While the upload runs, the image node has `loading: true`, so
  `renderMarkdown` does not write the base64 into content.
- If the upload fails, keep the node so the user sees "Upload failed", but
  `renderMarkdown` skips images with `error` set, the same as `loading`. This
  also closes the same leak in `insertAndUploadImage`, which kept the base64
  preview after a failed upload.
- Plain-text markdown pastes that contain `![](data:image/…)` get the same
  treatment through `tagDataImagesInJSON`.

### Phase 2: One `marked` instance per editor

- Pass `marked: new Marked()` to `Markdown.configure` in `WikiEditor` and
  `WikiContentViewer`, through one `wikiMarkdown()` helper. Tokenizers then
  belong to one editor and go away with it.
- `marked` becomes a direct dependency at `^17.0.1`, the range
  `@tiptap/markdown` uses. `frappe-ui` still pulls `marked@15`, so the
  transitive import would resolve to the wrong major.

### Phase 3: Take parsing off the keystroke path

- Memoize the canonical form of `savedContent` (recompute only when the
  prop changes).
- Memoize the canonical form of the editor markdown by ProseMirror doc
  identity. Docs are immutable, so one doc gives one canonical string.
- Debounce `content-change` emission from `onUpdate` (trailing 300 ms,
  max wait 2 s). Flush on blur, save (`saveToDB`, autosave), and unmount.
  This is the pattern used by Milkdown's listener plugin and other Tiptap
  editors.

### Deferred

- Server guard that extracts `data:` URIs into `File` docs on save, and a
  cleanup for pages that already have them.

## Progress

- [x] Phase 1: `paste-data-images.js` (`transformPasted` + markdown paste
  path), `image-markdown.js` split for tests, `paste-data-images.test.js`
- [x] Phase 2: `wiki-markdown.js` + `wiki-markdown.test.js`
- [x] Phase 3: `lib/editorContentSync.js` (+ test), wired into `WikiEditor`

## Results

Local production builds, with a seeded page shaped like the production one
(3 MB markdown, two 1.5 MB inline PNGs). The test types 24 characters with
real key presses and records long tasks.

| Build | Session | Time to type 24 chars | Longest task |
| --- | --- | --- | --- |
| `upstream/develop` | fresh load | 23.3 s | 971 ms |
| `upstream/develop` | after 10 page opens | ~260 s | 2,197 ms |
| this branch | fresh load | 0.68 s | 105 ms (one, after the pause) |
| this branch | after 10 page opens | 0.69 s | 93 ms (one, after the pause) |

Also checked in the browser:

- Text typed just before navigating away (inside the 300 ms window) is kept,
  after returning and after a reload.
- A pasted HTML `<img src="data:image/png…">` is uploaded and its `src`
  becomes a `/files/…` URL.
