# PDF Embeds in Wiki Documents

Date: 2026-06-11
Status: **Implemented & verified** on wiki.localhost (2026-06-11). See [Verification](#verification). Design below reflects decisions made during planning (see [Decisions](#decisions)); one aspect-ratio bug surfaced in testing and was fixed (the notes reflect the final implementation).

## Goal

Let authors embed a PDF in a wiki page from the editor. When the author picks the PDF toolbar/slash-command action, they choose a local file; it uploads to Frappe (same flow as images) and a **custom PDF node** is inserted that shows a polished, user-friendly preview — a card with the filename, page count, and a rendered thumbnail of the first page — which opens a **full-screen scroll/zoom viewer** on click. The same preview + viewer must also render on the **public** (server-rendered) reader side.

This mirrors the existing custom-block authoring patterns in wiki (`video-block.js`, `image-extension.js`, `iframe-block.js`) and the existing public-side image lightbox (`image-viewer.js`).

## Decisions

Settled during planning:

- **Render style → PDF.js inline scrollable card + full-screen viewer.** The card body is a fixed-height (max 600px) **scrollable** region rendering *all* pages inline, so a reader can page through the document without leaving the page; a maximize button opens the same content in a full-screen scroll/zoom modal. (This refines the original "first-page thumbnail" decision — during testing the inline preview was changed to a scrollable all-pages viewer per user feedback.) Not a bare native `<iframe>`/`<object>` embed. Cost accepted: PDF.js (`pdfjs-dist`) is added, and because the public reader is **not** Vue (see Current State), the viewer needs **two implementations** — a Vue one in the editor and a vanilla one on the public side.
- **Source → upload only.** Author picks a local file; it uploads via the existing `wiki.api.upload_wiki_asset` endpoint and embeds the `/files/...pdf` URL. No external-URL paste path in v1 (so no SSRF/CORS surface). This matches the "choose a file" flow described and the image upload flow.

## Library choice

**PDF.js (`pdfjs-dist`, Mozilla)** is the rendering engine, used two ways:

- **Editor (Vue 3, Vite):** [`vue-pdf-embed`](https://github.com/hrynko/vue-pdf-embed) — a thin Vue 3 wrapper over `pdfjs-dist`. Renders a single page as a thumbnail with `:source` + `:page="1"` + `:scale`, and the full document (omit `page`) in the viewer. Emits `@loaded` (document proxy → page count) and `@rendered` / `@loading-failed` for state.
  ```js
  import VuePdfEmbed, { GlobalWorkerOptions } from 'vue-pdf-embed/dist/index.essential.mjs'
  import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
  GlobalWorkerOptions.workerSrc = PdfWorker        // Vite ?url import — CSP-safe, no blob worker
  ```
  ```vue
  <VuePdfEmbed :source="src" :page="1" :scale="1" @loaded="onLoaded" @loading-failed="onError" />
  ```
- **Public reader (vanilla JS + Alpine, server-rendered):** `pdfjs-dist` used directly (`getDocument`, `page.render(canvas)`) from a new `pdf-viewer.js`, mirroring the existing `image-viewer.js`. Renders the first-page thumbnail into a `<canvas>` and opens the same modal markup the editor uses, but driven by vanilla JS.

Why PDF.js over alternatives: it's the battle-tested standard (Mozilla, ~52k★, 4M+ weekly downloads), free/OSS, renders consistently across desktop **and mobile** (native `<iframe>` embeds frequently fall back to a download prompt on mobile Safari/Chrome), and the same engine backs both the Vue wrapper and the vanilla public path — one engine, consistent output. (EmbedPDF was considered as a cleaner modern API but is younger; native embed was rejected per the render-style decision.)

Sources: [PDF.js](https://github.com/mozilla/pdf.js) · [vue-pdf-embed](https://github.com/hrynko/vue-pdf-embed) · [Top JS PDF viewers 2026 (Nutrient)](https://www.nutrient.io/blog/top-5-javascript-pdf-viewers/) · [6 OSS Vue PDF viewers 2025](https://www.vue-pdf-viewer.dev/blog/6-open-source-pdf-viewer-and-annotation-libraries-every-vue-developers-should-know-2025/)

## Current Wiki State (what we build on)

- **Editor:** TipTap v3 (Vue 3, ProseMirror). Custom block nodes live in `frontend/src/components/tiptap-extensions/`: `video-block.js` (+`VideoBlockView.vue`), `image-extension.js` (+`ImageNodeView.vue`), `iframe-block.js`, `callout-block.js`. They register in `frontend/src/components/WikiEditor.vue`'s `extensions` array. The toolbar is `tiptap-extensions/WikiToolbar.vue`; slash commands are `tiptap-extensions/slash-commands.js`. Icons are `lucide-vue-next`.
- **Content is stored as Markdown.** The editor runs with `contentType: 'markdown'`; nodes must round-trip via `markdownTokenizer` / `parseMarkdown` / `renderMarkdown`. **`video-block.js` is the exact template here**: it reuses image syntax `![alt](url)` and disambiguates by file extension (`isVideoUrl`). We do the same for PDFs — `![filename](/files/x.pdf)`, disambiguated by `.pdf`.
- **Upload:** all editor uploads funnel through `WikiEditor.vue::uploadFile(file)` → frappe-ui `useFileUpload().upload(file, { private:false, upload_endpoint:"/api/method/wiki.api.upload_wiki_asset" })` → returns `result.file_url`. The WebP work (`wiki/api/__init__.py::upload_wiki_asset`) already passes **non-convertible files straight through unchanged**, so PDFs route through it with no backend change (pending the allowed-extensions check in Open Questions). The image upload flow also has an optimistic-preview + `loading`/`uploadId`/`error` pattern (`insertAndUploadImage` in `WikiEditor.vue`, transient `rendered:false` attrs in `image-extension.js`, overlay in `ImageNodeView.vue`) — **we mirror this for the PDF upload's in-flight state.**
- **Public reader is server-rendered Jinja + markdown-it-py + Alpine.js — NOT Vue.** Route is intercepted by `WikiDocumentRenderer` (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.py`), content rendered by `wiki/wiki/markdown.py::render_markdown_with_toc()` into `wiki/templates/wiki/document.html` (`{{ rendered_content | safe }}`). Custom blocks (videos, callouts) use a **placeholder-extraction** pattern in `markdown.py`: pre-scan the markdown, swap matches for `WIKIxxxPLACEHOLDER<i>END` sentinels *before* markdown-it parses, then swap the sentinels for block HTML after render (`_process_videos_with_placeholders` / `_replace_video_placeholders`, `_generate_video_html`). **We add an exactly parallel PDF path.** Public enhancement JS lives in `wiki/public/js/` (`image-viewer.js`, `code-blocks.js`) and is wired into `wiki/templates/wiki/layout.html`; the lightbox modal markup lives in the template and is re-bound after SPA navigation via a `MutationObserver` on `#wiki-content`.
- Content fields have `ignore_xss_filter: 1` and the markdown renderer allows raw HTML (only `<script>` is stripped from alt/title) — so the PDF card HTML we emit passes through to the page untouched. We still emit only our own controlled markup (no user HTML).

## Non-Goals (v1)

- **No external-URL PDFs** — upload only (per Decisions). No URL-paste node, no SSRF guard, no cross-origin fetch.
- **No annotations, form filling, text selection, or search** inside the viewer. Read-only render (thumbnail + scroll/zoom). PDF.js `textLayer`/`annotationLayer` stay **off** in v1 (smaller, simpler, no CMap/image-resources wiring needed).
- **No server-side thumbnail generation.** The first-page thumbnail is rendered client-side by PDF.js on both sides. (A server-side poster image is a possible Phase 2 for faster first paint / no-JS fallback.)
- **No conversion/optimization** of the PDF (unlike the WebP image path). The file is stored and served as-is.
- **No edits to the legacy `Wiki Page` server-rendered portal** beyond the shared `markdown.py` path it already uses, if applicable — primary target is the `Wiki Document` reader.
- No multi-file / gallery embeds; one PDF per node.

## Design

### Markdown representation

Reuse image syntax, disambiguated by extension (identical strategy to videos):

```
![Annual Report 2026.pdf](/files/annual_report.pdf)
```

- `alt` = the **original filename** (display name on the card), captured from `file.name` at upload — distinct from the hashed `/files/...` URL.
- Disambiguation by `.pdf` extension via a shared `isPdfUrl(url)` (editor) and `_is_pdf_url(url)` (Python), mirroring `isVideoUrl` / `_is_video_url`.
- **Tokenizer precedence:** the PDF block's `markdownTokenizer` and the public `_process_pdfs_with_placeholders` must run/match before the plain image path so a `.pdf` is never rendered as a broken `<img>`. Mirror exactly how the video block already wins over the image node for `.mp4`.

### 1. Editor — new node `pdf-block.js` (+ `PdfBlockView.vue`)

New files in `frontend/src/components/tiptap-extensions/`, modeled on `video-block.js` + `VideoBlockView.vue`, with the image extension's upload-state pattern grafted on.

`pdf-block.js`:
- `Node.create({ name: 'pdfBlock', group:'block', atom:true, draggable:true })`.
- **Attributes:** `src` (default `''`), `filename` (default `''`, → markdown `alt`). Transient editor-only state with **`rendered:false`** (kept out of serialized markdown, mirroring the image extension): `loading`, `uploadId`, `error`, and optionally `pageCount` (display-only, recomputed on load).
- `parseHTML` / `renderHTML`: emit a `div[data-type="pdf-block"][data-src][data-filename]` wrapper (parallels `video-block`'s `data-type="video-block"`). `renderHTML` is what gets parsed back from saved HTML; the live editor view comes from the node view.
- `markdownTokenizer` (name `pdfBlock`, block level): match `^!\[([^\]]*)\]\(([^)]+)\)`, return `undefined` unless `isPdfUrl(url)` — copy of the video tokenizer.
- `parseMarkdown(token)` → `{ type:'pdfBlock', attrs:{ src, filename: alt } }`.
- `renderMarkdown(node)` → `` `![${filename}](${src})\n\n` `` — and, like the image extension, **early-return `''` while `node.attrs.loading`** so an autosave mid-upload never persists a transient/blob src.
- `addNodeView()` → `VueNodeViewRenderer(PdfBlockView)`.
- `addCommands()`: `setPdf(attrs)` (insert node) and `selectAndUploadPdf()` (programmatically open a hidden `<input type="file" accept="application/pdf,.pdf">`, then run the upload command) — copy `selectAndUploadVideo`'s structure. `uploadFunction` is injected as a node option from `WikiEditor.vue` (same wiring videos use), so the node reuses the shared `uploadFile`.

`PdfBlockView.vue` (the in-editor card), modeled on `VideoBlockView.vue` + `ImageNodeView.vue`:
- `NodeViewWrapper`, `contenteditable=false`, selection ring when `selected`.
- **Loading state** (`node.attrs.loading`): card skeleton + spinner + filename + "Uploading…", matching `ImageNodeView`'s overlay (self-contained CSS spinner, wiki tokens). **Error state** (`node.attrs.error`): inline error with a retry/remove affordance, no broken embed.
- **Loaded state:** `<VuePdfEmbed :source="src" :page="1" :scale="1" @loaded>` renders the first page into the card; header shows filename + page count (from `@loaded` document proxy). A delete (trash) control mirrors the other blocks.
- Clicking the thumbnail opens the **full-screen viewer** — a shared `PdfViewerModal.vue` (teleported overlay) that renders `<VuePdfEmbed :source="src" />` (all pages) with scroll, plus zoom +/− (bind `:scale`), page indicator, download, and close (Esc / backdrop click). This modal is editor-only; the public side reuses the same *markup/CSS* via vanilla JS (§4).

### 2. Editor — upload flow & registration (`WikiEditor.vue`)

- Reuse the existing `uploadFile(file)` (already points at `upload_wiki_asset`). No new endpoint.
- Add an `insertAndUploadPdf(file)` helper paralleling `insertAndUploadImage`: insert the `pdfBlock` node immediately with `{ filename: file.name, uploadId, loading:true }` (no preview src needed — show the loading card), `await uploadFile(file)`, then locate the node by `uploadId` (`doc.descendants` scan + `setNodeMarkup`) and set `src`→real url, `loading:false` (or `error` on failure). Mirrors `updateImageNode`.
- Register `PdfBlock` in the `extensions` array (configure its `uploadFunction` option like `VideoBlock`).
- Wire the toolbar/slash entry points to `insertAndUploadPdf` (or to `editor.commands.selectAndUploadPdf()`).

### 3. Editor — toolbar + slash command

- **Toolbar** (`WikiToolbar.vue`): add a PDF button (lucide `FileText` / `File`) next to the image/video buttons; on click open the hidden file input (`accept="application/pdf,.pdf"`) → emit to `WikiEditor.vue`'s `insertAndUploadPdf`, copying the image button's `triggerImageUpload`/`handleImageSelect` pair.
- **Slash command** (`slash-commands.js`): add a `{ title:'PDF', description:'Upload and embed a PDF', icon:…, command }` entry that triggers the same upload flow (`editor.chain().focus().deleteRange(range).selectAndUploadPdf().run()`).

### 4. Public reader — `markdown.py` + `pdf-viewer.js` + template + CSS

**Python (`wiki/wiki/markdown.py`)** — add a PDF block path exactly parallel to videos:
- `PDF_MARKDOWN_PATTERN` (clone of `VIDEO_MARKDOWN_PATTERN`) + `_is_pdf_url(url)`.
- `_process_pdfs_with_placeholders(content)` → swap full-line `.pdf` image syntax for `WIKIPDFPLACEHOLDER<i>END` sentinels before parse; `_replace_pdf_placeholders(html, …)` swaps them back; `_generate_pdf_html(url, filename)` emits the card:
  ```html
  <div class="wiki-pdf-embed" data-type="pdf-block" data-src="/files/x.pdf" data-filename="Annual Report 2026.pdf">
    <div class="wiki-pdf-card">
      <div class="wiki-pdf-header">📄 <span class="wiki-pdf-name">Annual Report 2026.pdf</span>
        <span class="wiki-pdf-pages"></span>
        <a class="wiki-pdf-download" href="/files/x.pdf" download>Download</a></div>
      <canvas class="wiki-pdf-thumb"></canvas>           <!-- filled by pdf-viewer.js -->
      <noscript><a href="/files/x.pdf">Open Annual Report 2026.pdf</a></noscript>
    </div>
  </div>
  ```
  Reuse the existing `_remove_script_tags` on `filename`. Hook `_process_pdfs_with_placeholders` / `_replace_pdf_placeholders` into `render_markdown_with_toc()` right beside the video calls.

**Public JS (`wiki/public/js/pdf-viewer.js`)** — new file modeled on `image-viewer.js`:
- On load (and via `MutationObserver` on `#wiki-content` for SPA nav), find every `.wiki-pdf-embed`, lazily (`IntersectionObserver`) `getDocument(data-src)`, render page 1 into its `<canvas>`, and fill `.wiki-pdf-pages` with `numPages`.
- Click on the card → open a shared full-screen modal (markup added to the layout/template, styled like the image lightbox) that renders all pages to canvases with scroll + zoom + download + close (Esc/backdrop), reusing the existing lightbox open/close/`image-viewer-open` body-lock conventions.
- Loads `pdfjs-dist` as ES modules; file included as `type="module"`.

**Template (`wiki/templates/wiki/...`)** — add the PDF viewer modal container (parallel to the `#image-viewer` element) and include `pdf-viewer.js` + the pdfjs assets in `layout.html`.

**CSS (`wiki/public/css/main.css`)** — `.wiki-pdf-embed` card + modal styles using the existing wiki/prose tokens, consistent with image/video block styling.

### 5. Public asset packaging for `pdfjs-dist` (the main implementation risk)

The public reader is **not** built by the frontend Vite pipeline, so `pdfjs-dist` isn't automatically available there. Plan: **vendor** the prebuilt `pdf.min.mjs` + `pdf.worker.min.mjs` from `pdfjs-dist` into `wiki/public/js/vendor/pdfjs/` and import them from `pdf-viewer.js` (ESM, `type="module"`), setting `GlobalWorkerOptions.workerSrc` to the vendored worker path. Self-contained (works offline / air-gapped), no external runtime dependency, version pinned in-repo. With `textLayer`/`annotationLayer` off we **don't** need CMap/image-resource assets, keeping the vendored payload small. (Alternative: load pdfjs from a CDN — simpler but adds an external runtime dependency and breaks offline; rejected as the default. See Open Questions.) Confirm `bench build` serves the vendored files as-is and that the editor's Vite build dedupes its own `pdfjs-dist` copy.

## Acceptance Criteria

- Toolbar PDF button and `/pdf` slash command both open a file picker; choosing a PDF shows an immediate loading card, uploads via `wiki.api.upload_wiki_asset`, then swaps to a thumbnail card (filename + page count). On failure, an inline error (no frozen editor, no broken embed).
- The embed round-trips: saving persists `![filename](/files/x.pdf)`; reloading the editor restores the PDF card (never a base64/blob src, never a broken `<img>`).
- On the **public** page the same PDF renders as a first-page thumbnail card with filename + page count; clicking opens a full-screen scroll/zoom viewer with download + close; works after SPA navigation; renders on mobile.
- No-JS / failed-pdfjs degrades to a "Download / Open <filename>" link (`<noscript>` + error fallback).
- Non-PDF uploads and existing image/video blocks are unaffected.

## Open Questions

- **pdfjs public packaging — vendor vs CDN.** Plan vendors into `wiki/public/js/vendor/pdfjs/`. Confirm size is acceptable and that Frappe serves `.mjs` with the right MIME type; otherwise fall back to a single bundled IIFE or CDN. **Resolved (see Verification): vendored as `.js`, not `.mjs`** — nginx in production serves `.mjs` as `application/octet-stream` and the browser refuses to import it as a module.
- **Allowed upload extensions.** Confirm Frappe's `upload_file` (via `upload_wiki_asset`) permits `.pdf` for the relevant roles / site `allow_attachment` settings; if a restriction exists, relax it for PDFs.
- **Max PDF size / very large docs.** Should we cap upload size and/or lazy-render only the first page until the viewer opens? (Plan already lazy-renders thumbnails and defers all-pages render to the modal.)
- **Private files.** v1 uploads public (`private:false`), matching images. Private/permissioned PDFs are out of scope.
- **Page-count source on first paint.** Server HTML ships filename only; page count is filled by pdfjs after thumbnail render. Acceptable, or do we want a server-side page count (needs a PDF lib like `pypdf` at render/upload time)?

## Verification

Tested end-to-end on **wiki.localhost** (Administrator), 2026-06-11, with a generated 2-page PDF.

- **Editor:** the toolbar **Insert PDF** button and the `/pdf` slash command appear and open a file picker. Uploading routes through `wiki.api.upload_wiki_asset` (**200**); the card shows a loading state, then renders an inline **scrollable** all-pages viewer (via vue-pdf-embed, max-height 600px) with filename + "2 pages" in a fixed header — scrolling the card body reveals page 2. Clicking **Open viewer** opens the full-screen modal with both pages, zoom (−/120%/+), download, and Esc/✕ close.
- **Persistence / round-trip:** the editor serializes `![wiki-test.pdf](/files/wiki-test.pdf)` — no base64, no transient state. After reload, the markdown parses straight back into a PDF card with thumbnail + page count.
- **Public reader:** after merging the change request, `/pdf-test-space/pdf-demo-page` server-renders the `.wiki-pdf-embed` card; `pdf-viewer.js` hydrates the inline scrollable viewer — all pages rendered into the 600px-tall `.wiki-pdf-scroll` container (scrollHeight 1991 > 600, scrolling reveals page 2) plus page count (`is-ready`); the **Open** button launches the vanilla full-screen viewer (both pages, zoom, download, close). The vendored `pdf.min.mjs` / `pdf.worker.min.mjs` are served as `text/javascript`, so the dynamic ESM import works.
- **No regressions:** a normal `.png` still renders as `<img>`; a `.mp4` still renders as the video block.

**Bug found & fixed during testing — public thumbnail aspect ratio.** The public card's `<canvas>` was a *direct* flex child of `.wiki-pdf-thumb` (`display:flex`), so the default `align-items: stretch` overrode the canvas's `height:auto` and stretched the portrait page horizontally. (The editor escaped it because vue-pdf-embed wraps the canvas in a `<div>`.) Fix: make `.wiki-pdf-thumb` a `display:block` container in both `main.css` and `PdfBlockView.vue` so `width:100% + height:auto` preserves the intrinsic ratio (verified: displayed ratio 0.773 == page ratio 612/792, cropped to a 420px-tall preview).

**Bug found & fixed — `.mjs` MIME type on production (post-merge).** Local verification passed because the werkzeug dev server resolves `.mjs` to `text/javascript`, but production nginx has no MIME mapping for `.mjs` and serves the vendored `pdf.min.mjs` / `pdf.worker.min.mjs` as `application/octet-stream`. The browser enforces strict MIME checking for module scripts and refuses to execute them, so the dynamic `import()` failed (`Failed to fetch dynamically imported module … pdf.min.mjs`) and the public cards never rendered. Fix: vendor the files as `pdf.min.js` / `pdf.worker.min.js` and point `PDFJS_SRC` / `WORKER_SRC` at them. `.js` is reliably served as `text/javascript`, and `import()` keys off the MIME type (not the extension), so the files still load as ES modules. The internal `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"` default inside `pdf.min.js` is never hit because `pdf-viewer.js` sets `workerSrc` explicitly.

**Bug found & fixed — stale cached `pdf-viewer.js`.** The public static scripts were served at fixed URLs with `Cache-Control: max-age=43200` (12h) and **no cache-busting**, so after the markup/JS structure changed, a browser holding the old `pdf-viewer.js` ran it against the new HTML, found neither the old `<canvas>` nor matched the new container, and silently rendered an empty card. Fix: a `get_asset_hash(path)` jinja helper (`wiki/utils.py`, registered in `hooks.py`, mirroring `get_tailwindcss_hash`) now appends a content hash `?v=<hash>` to the `pdf-viewer.js` / `image-viewer.js` / `code-blocks.js` script tags in `layout.html`, so any change to those files busts the browser cache. (Same class of bug would have hit real users for up to 12h after any deploy that changed these files.)

Note on automated testing: the toolbar/slash actions open a file picker via a *dynamically created* `<input type=file>` (not a stable DOM node), so a browser harness can't target it with `setInputFiles`. The upload path was exercised by dispatching the same `wiki-editor-upload-pdf` CustomEvent the picker fires, carrying a real in-page `File` — which runs the full `insertAndUploadPdf` → upload → node-patch flow. (A future Playwright e2e can use `page.on('filechooser')` instead.)

## Phase 2 (future, not in this spec)

- Server-side first-page poster image (faster first paint, true no-JS preview).
- External-URL PDF embeds (with SSRF guard + CORS handling for pdfjs fetch), reusing the `iframe-block.js` URL-normalization patterns.
- In-viewer text selection / search / annotations (turn on pdfjs `textLayer`, wire CMap + image-resources assets).
- Caption support on the PDF node, mirroring the image caption.

## Files to touch (summary)

| File | Change |
|---|---|
| `frontend/src/components/tiptap-extensions/pdf-block.js` | **New** — `PdfBlock` node: attrs, markdown round-trip (extension-disambiguated), upload commands, node view |
| `frontend/src/components/tiptap-extensions/PdfBlockView.vue` | **New** — in-editor card: loading/error/loaded states, first-page thumbnail (`vue-pdf-embed`), open-viewer |
| `frontend/src/components/tiptap-extensions/PdfViewerModal.vue` | **New** — shared full-screen viewer (all pages, scroll/zoom/download/close) |
| `frontend/src/components/WikiEditor.vue` | Register `PdfBlock` (+`uploadFunction`); add `insertAndUploadPdf` (mirror `insertAndUploadImage`); wire entry points |
| `frontend/src/components/tiptap-extensions/WikiToolbar.vue` | PDF toolbar button + hidden file input |
| `frontend/src/components/tiptap-extensions/slash-commands.js` | `/pdf` slash command |
| `frontend/package.json` | Add `pdfjs-dist` + `vue-pdf-embed` |
| `frontend/vite.config.js` | (If needed) pdf worker `?url` handling / dedupe `pdfjs-dist` |
| `wiki/wiki/markdown.py` | `_is_pdf_url`, `PDF_MARKDOWN_PATTERN`, `_process_pdfs_with_placeholders`/`_replace_pdf_placeholders`/`_generate_pdf_html`; hook into `render_markdown_with_toc` |
| `wiki/public/js/pdf-viewer.js` | **New** — vanilla pdfjs: thumbnail render + modal viewer (mirror `image-viewer.js`) |
| `wiki/public/js/vendor/pdfjs/*` | **New** — vendored `pdf.min.js` + `pdf.worker.min.js` (vendored as `.js`, not `.mjs`, so production nginx serves them as `text/javascript`) |
| `wiki/templates/wiki/layout.html` | Include cache-busted `pdf-viewer.js?v=<hash>` (modal is built in JS, not static markup) |
| `wiki/utils.py` + `wiki/hooks.py` | `get_asset_hash(path)` jinja helper for `?v=<hash>` cache-busting of public JS |
| `wiki/public/css/main.css` | `.wiki-pdf-embed` card + viewer-modal styles |
| `wiki/api/__init__.py` | None expected (PDFs pass through `upload_wiki_asset`); only touch if the allowed-extension check needs relaxing |
| `e2e/tests/pdf-embed.spec.ts` | **New** — Playwright: upload → card → save/reload round-trip → public render |
