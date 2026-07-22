# Automatic WebP Image Optimization

Date: 2026-06-09
Status: **Implemented & verified** on wiki.localhost (2026-06-09). See [Verification](#verification). Two issues surfaced during testing and were fixed; the design notes below reflect the final implementation, not the original plan.

## Goal

Add a Wiki Settings toggle that, when enabled, automatically converts every newly uploaded image (PNG/JPEG/JPG) in the wiki editor to WebP — so wiki pages serve smaller, faster-loading images without authors doing any extra work.

This mirrors the auto-on-upload design in `apps/builder`, adapted to wiki's TipTap-based authoring flow. (Builder also ships a manual per-image "optimize" button; we are intentionally **not** porting that — see Non-Goals and Phase 2.)

## Reference Implementation (builder)

Builder centralizes conversion in one whitelisted endpoint. The part we are porting:

- **Core converter** — `builder/api.py::convert_to_webp(image_url=None, file_doc=None)`. Conversion itself is just Pillow: `image.save(path, "WEBP")`, with the extension swapped `.png/.jpg/.jpeg → .webp`. For a freshly-uploaded `File` doc it converts in place via `get_local_image()` and deletes the original.
- **Auto path** — `builder/api.py::upload_builder_asset()` wraps Frappe's `upload_file()`; if the result is png/jpg/jpeg **and** the `auto_convert_images_to_webp` Builder Setting is enabled, it calls `convert_to_webp(file_doc=...)`.
- **Default-on patch** — a migration flips `auto_convert_images_to_webp` on for existing sites.

Builder additionally exposes a manual per-image "Convert to WebP" / "Serve Locally" button (`imageUtils.ts`) backed by the same endpoint's local-url and external-url handlers (plus an SSRF guard). **We are not porting that** — wiki only needs the auto-on-upload behavior.

## Current Wiki State

- All editor image uploads funnel through one function: `frontend/src/components/WikiEditor.vue::uploadFile(file)` (paste `handlePaste`, drag-drop `handleDrop`, toolbar `handleImageUpload`, slash-command `handleSlashImageSelect`). It calls frappe-ui's `useFileUpload().upload(file, { private: false })` and returns `result.file_url`, which is handed to `setImage({ src: url })`.
- frappe-ui's `UploadOptions` supports both `upload_endpoint` (the URL the multipart POST is sent to) and `method` (a form field passed to `/api/method/upload_file` telling it to *delegate* to another whitelisted method). **These are not interchangeable** — see Design §4 and Verification: `method` causes a delegation loop here, so we use `upload_endpoint`.
- Backend whitelisted APIs live in `wiki/api/__init__.py` (app module `wiki`, so the method path is `wiki.api.<fn>`). Settings live in the `Wiki Settings` single doctype (`wiki/wiki/doctype/wiki_settings`).
- Python `>=3.14`. Pillow is not a *declared* dependency but is already present in the bench env (12.1.1, a frappe transitive dep). We declare it explicitly anyway.
- The image node stores only `src`; no per-image "original format" metadata is kept.

## Non-Goals

- **No per-image manual button** ("Convert to WebP" / "Serve Locally"). This v1 is purely the settings toggle + auto-convert on new uploads.
- **No external-image fetching/serving** — so no SSRF guard, no `requests`-based download path.
- Do not convert images already embedded in existing pages. A space-level batch convert is a possible Phase 2 (see below), not part of v1.
- Do not change the markdown/TipTap image node schema or caption behavior.
- Do not touch the `wiki` (legacy) server-rendered portal rendering path.
- Do not add client-side (browser) conversion — keep conversion server-side with Pillow for consistent output.
- Do not resize/crop (`max_width`/`max_height` out of scope).

## Design

### 1. Backend: core converter — `wiki/api/__init__.py`

Add a small helper that converts a freshly-uploaded `File` doc in place:

```python
def convert_file_to_webp(file_doc) -> str:
    """Convert a local PNG/JPEG File doc to WebP in place.
    Replaces the file on disk, deletes the original, updates file_url.
    Returns the new (or unchanged) file_url."""
```

Logic (ported from builder's `handle_file_doc`, with two corrections — see Verification):

- Only act on local files (`file_url` starts with `/files`) whose extension is convertible (`(".png", ".jpeg", ".jpg")`); otherwise return `file_url` unchanged.
- `image, _, _ = get_local_image(file_url)` → `image.save(_to_webp(file_doc.get_full_path()), "WEBP")` → `delete_file(file_url)` → set `file_doc.file_url`/`file_name` to the `.webp` equivalents → `file_doc.save()`.
- Extension swap uses `_to_webp(s) = os.path.splitext(s)[0] + ".webp"` (robust for both `.jpg` and `.jpeg`), **not** builder's naive `str.replace(extn, "webp")`.

**Correction 1 — `delete_file` needs the URL, not the absolute path.** `frappe.core.doctype.file.utils.delete_file` derives the public/private files dir from the *leading segment* of what it's given (`files/...` → public, anything else → private). Passing `file_doc.get_full_path()` (an absolute path) silently resolves to the *private* dir, finds nothing, and **leaves the original on disk**. Pass the `/files/...` `file_url` instead. (Builder passes the full path and has this latent bug; it just doesn't bite there.)

**Correction 2 — also update `file_name`.** Builder updates only `file_url`, leaving `file_name` as the original `.jpg` — confusing in the Files list. We swap both so the File doc is internally consistent.

Reuse `frappe.core.doctype.file.file.get_local_image` and `...file.utils.delete_file`. No external-url or copy-creating handlers are needed in v1 — those only existed for builder's manual button. Pillow/file imports are done **lazily inside the function** so a missing Pillow can never break the other whitelisted methods in this module at import time.

**Graceful fallback.** The Pillow decode/encode is wrapped in `try/except`: on any failure (corrupt/truncated/odd image) it `frappe.log_error`s and returns the original `file_url` unchanged — the upload still succeeds with the original file rather than 500-ing and losing the author's image. (Surfaced by the e2e test, which initially used a malformed PNG.)

### 2. Backend: auto-on-upload handler — `wiki/api/__init__.py`

Add a thin custom endpoint that wraps Frappe's `upload_file()`. The frontend posts directly to this endpoint (see §4), so inside it `frappe.form_dict.method` is empty and `upload_file()` creates the File doc normally — no delegation:

```python
CONVERTIBLE_IMAGE_EXTENSIONS = (".png", ".jpeg", ".jpg")

@frappe.whitelist()
def upload_wiki_asset():
    from frappe.handler import upload_file
    file_doc = upload_file()
    if (file_doc
        and (file_doc.file_url or "").lower().endswith(CONVERTIBLE_IMAGE_EXTENSIONS)
        and frappe.get_cached_value("Wiki Settings", "Wiki Settings",
                                    "auto_convert_images_to_webp")):
        convert_file_to_webp(file_doc)
    return file_doc
```

This keeps conversion opt-out-able via settings and avoids a second round-trip (convert happens server-side within the upload request). Non-convertible files (`.gif`, `.svg`, already-`.webp`) pass straight through unchanged, so it is safe to route *all* editor uploads here.

### 3. Settings: `Wiki Settings` toggle

Add a `Check` field `auto_convert_images_to_webp` (default `1`, label "Convert Uploaded Images to WebP") to `wiki/wiki/doctype/wiki_settings/wiki_settings.json`, placed in the existing "Wiki Page Configurations" section right after `enable_table_of_contents` (also added to `field_order`). The field default only applies to *new* sites; the existing single row is null until backfilled, so add a patch:

```python
# wiki/wiki/doctype/wiki_settings/patches/enable_auto_convert_to_webp.py
def execute():
    frappe.db.set_single_value("Wiki Settings", "auto_convert_images_to_webp", 1)
```

Register it in `wiki/patches.txt` under `[post_model_sync]` as
`wiki.wiki.doctype.wiki_settings.patches.enable_auto_convert_to_webp`. The Desk single-doctype form surfaces the toggle for v1; no dedicated frontend settings UI is added.

### 4. Frontend: route uploads through the custom handler — `WikiEditor.vue`

Point `uploadFile` at the new endpoint via **`upload_endpoint`** so the multipart POST goes *directly* to our handler:

```js
const result = await fileUploader.upload(file, {
    private: false,
    upload_endpoint: "/api/method/wiki.api.upload_wiki_asset",
});
return result.file_url;   // already the .webp url when conversion ran
```

**Do not use the `method` option here.** frappe-ui's `method` is *not* an endpoint override — it is sent as a form field to `/api/method/upload_file`, which then does `frappe.get_attr(method)()` to delegate. Since our `upload_wiki_asset` itself calls `upload_file()`, and `method` is still in the form dict on that second call, `upload_file` delegates again → infinite loop → HTTP 500. (This is exactly what happened in testing.) `upload_endpoint` sends the POST straight to our method, where `form_dict.method` is empty and the single `upload_file()` call behaves normally. This is also how builder works — its frontend calls `upload_builder_asset` as the endpoint, not via `method`.

The three upload entry points **do** change (they no longer just `setImage` with the resolved url) — see §5; they route through the shared `insertAndUploadImage(file)` helper.

### 5. Frontend UX: upload + conversion progress indicator

Because conversion runs inline inside the upload request (see Open Questions), the round-trip is now upload **+** Pillow encode — long enough that the editor must not look frozen. Today wiki `await`s `uploadFile()` and only then calls `setImage({ src })`, so nothing appears until everything finishes. Adopt frappe-ui's optimistic-placeholder pattern (`frappe-ui/.../TextEditor/extensions/image/image-extension.ts` + `ImageNodeView.vue`):

**Pattern:**

1. **Insert immediately with a local preview.** Before uploading, insert the image node with `src` = a base64 data-url of the file (`fileToBase64` from frappe-ui), plus a unique `uploadId` and `loading: true`. The author sees their image instantly.
2. **Show a loading overlay.** In `ImageNodeView.vue`, when `node.attrs.loading` is true, render a dim overlay with a spinner + "Uploading…" (frappe-ui uses its `LoadingIndicator`; wiki can use the same or `frappe-ui`'s `Spinner`). The actual upload/convert runs in the background.
3. **Swap to the final url on success.** When `uploadFile` resolves (returning the already-converted `.webp` url), find the node by `uploadId` and set `src` → real url, `loading: false`.
4. **Surface failures.** On error, set `loading: false` and `error: message`; the node view shows an error instead of a silent broken image.

**Wiki-specific changes:**

- Add `loading`, `uploadId`, and `error` attributes to `WikiImage` (`image-extension.js`) with **`rendered: false`** — they stay available to the NodeView but are kept out of serialized HTML. They are transient editor-only state.
- **Guard `renderMarkdown` against the in-flight preview.** `WikiImage.renderMarkdown` must early-return `''` when `node.attrs.loading` is truthy. Otherwise, if an autosave fires mid-upload (the local-first editor autosaves), the transient base64 data-url in `src` would be written into the saved markdown. Once the upload resolves and `loading` clears, the node re-serializes normally with the real url. **Verified**: after upload + save + full reload, persisted content holds `/files/...webp`, never base64.
- Add the loading-overlay + error markup to `ImageNodeView.vue`, wrapping the `<img>` in a positioned `.wiki-image-frame`. Uses a self-contained CSS spinner (no extra import) styled with wiki tokens; the caption input is hidden while an error is shown.
- Rework the upload entry points (`handlePaste`, `handleDrop`, `handleImageUpload`) to call a shared `insertAndUploadImage(file)` helper that: reads the file to base64, inserts the node with `{ src: preview, uploadId, loading: true }`, awaits `uploadFile`, then `updateImageNode(uploadId, …)` to patch `src`/`loading`/`error` by locating the node via a `doc.descendants` scan + `setNodeMarkup` transaction.

This single change covers both plain upload latency and the added webp-conversion time, so authors always get immediate feedback regardless of how long the server takes.

### 6. Dependency

Pillow is used (`from PIL import Image`) but **not declared** — it comes in transitively via frappe (12.1.1 in the bench env). This matches builder's convention, which also imports Pillow without declaring it. (We initially declared `Pillow>=10.0` but dropped it to stay consistent with builder / avoid a redundant line.)

## Acceptance Criteria

- Uploading a PNG/JPEG via paste, drag-drop, toolbar, or slash command (with the setting on) embeds a `.webp` image; the original png/jpg is removed from disk.
- A non-convertible upload (e.g. `.gif`, `.svg`, already-`.webp`) is embedded unchanged.
- Disabling `auto_convert_images_to_webp` uploads the original format unchanged.
- Existing sites get the setting defaulted on after `bench migrate`.
- During upload/conversion, the image appears immediately with a loading overlay; it swaps to the final `.webp` on success, or shows an error on failure (no silent broken image, no frozen-looking editor).

## Phase 2 (future, not in this spec): per-space batch convert

Later we may add a **per-space** setting and a "Convert images to WebP" button that converts all images already embedded in a space's pages:

- Add the conversion option (and/or the button) at the `Wiki Space` level rather than only the global toggle.
- The button enqueues a background job that walks every page in the space, finds local `/files/...` png/jpg images in the markdown, converts each to WebP, and rewrites the page content `src` references.
- This reuses the same Pillow conversion but operates on already-embedded local images — closer to builder's `handle_local_url` (convert + rewrite reference). Scope, idempotency, and reference-rewriting safety to be detailed in that spec.

## Resolved Decisions

- **Sync vs. enqueue conversion → inline (sync).** Conversion runs inside the upload request, matching builder. The optimistic placeholder + loading overlay (§5) hide the added latency, and small/medium images convert fast enough that this is imperceptible. Revisit only if very large uploads become a problem.
- **`upload_endpoint`, not `method`** for routing to the handler (§4) — `method` causes a delegation loop.
- **`delete_file(file_url)`, not the absolute path** (§1) — otherwise the original is not removed.

## Open Questions

- WebP quality/lossless: uses Pillow defaults (lossy, quality≈80). Keep defaults unless a quality knob is requested.
- The success toast in `uploadFile` now coexists with the inline overlay/error UI. Slightly redundant on failure (toast + inline error); left as-is. Drop the toast if it feels noisy.

## Verification

Migrated and tested end-to-end on **wiki.localhost** (administrator), 2026-06-09.

- `bench migrate` ran the patch; `auto_convert_images_to_webp` reads `1`.
- **Backend (bench console):** PNG and JPEG convert in place — webp written, original removed from disk, `file_url`/`file_name` updated. GIF and already-`.webp` pass through unchanged.
- **Browser (real editor):** uploading via the editor inserts an instant base64 preview with the loading overlay, POSTs to `wiki.api.upload_wiki_asset` (**200**), then swaps to `/files/<name>.webp`. Original `.jpg`/`.png` deleted; webp served with `Content-Type: image/webp`.
- **Persistence:** after Save + full page reload, the image resolves to `/files/<name>.webp` with no base64 in stored content (confirms the `renderMarkdown` loading-guard).
- `ruff check` passes on the Python changes.

**Automated e2e** — `e2e/tests/webp-conversion.spec.ts` (Playwright): opens the editor on a fresh page, uploads a PNG via the hidden file input, and asserts (1) with the setting **on**, the embedded `src` and the `File` doc become `.webp`; (2) with the setting **off**, the image stays `.png`. Notes for maintainers:
- The test builds its own valid PNG in Node with a unique `tEXt` nonce per upload — required because Frappe content-hash-deduplicates identical uploads, which otherwise made one test reuse another's already-converted file. (This dedup is harmless/beneficial in production.)
- It toggles the global `Wiki Settings` flag via the REST API and restores it (`afterEach`), and best-effort-deletes its `File` docs (`afterAll`).
- Run against this site with `BASE_URL=http://wiki.localhost:8000 yarn playwright test webp-conversion`.

**Two bugs found & fixed during this testing** (folded into §1 and §4 above): (1) `method` vs `upload_endpoint` delegation loop → 500; (2) `delete_file` given an absolute path left the original on disk.

## Files Touched (summary)

| File | Change |
|---|---|
| `wiki/api/__init__.py` | Add `CONVERTIBLE_IMAGE_EXTENSIONS`, `_to_webp`, `convert_file_to_webp` helper + `upload_wiki_asset` handler (lazy Pillow/file imports) |
| `wiki/wiki/doctype/wiki_settings/wiki_settings.json` | Add `auto_convert_images_to_webp` check field (default 1) + `field_order` |
| `wiki/wiki/doctype/wiki_settings/patches/enable_auto_convert_to_webp.py` + `wiki/patches.txt` | Default-on migration (`set_single_value`) |
| `frontend/src/components/WikiEditor.vue` | Route `uploadFile` through `upload_endpoint: "/api/method/wiki.api.upload_wiki_asset"`; add `fileToBase64` / `updateImageNode` / `insertAndUploadImage`; rewire paste/drop/toolbar call sites |
| `frontend/src/components/tiptap-extensions/image-extension.js` | Add transient `loading` / `uploadId` / `error` attrs (`rendered: false`) + `renderMarkdown` loading-guard |
| `frontend/src/components/tiptap-extensions/ImageNodeView.vue` | Add `.wiki-image-frame`, loading overlay (CSS spinner) + error markup |
| `e2e/tests/webp-conversion.spec.ts` | Playwright e2e: on/off conversion through the editor + File-doc assertions |

Pillow is relied on transitively via frappe (not declared in `pyproject.toml`), matching builder.
