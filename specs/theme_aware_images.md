# Theme-aware images

## Why?

Screenshots taken in light mode look wrong on a dark wiki, and the reverse. Authors have no way to give one image a light and a dark version, so they either pick one theme or paste both.

## What?

One image block can hold a light and a dark version, the way GitBook does it. Readers see the version that matches the wiki theme, and fall back to the light one when there is no dark one.

- Select an image in the editor and a small menu appears on it:
  - Replace image (both modes)
  - For light mode
  - For dark mode
  - Remove dark mode image (only when one is set)
- The editor shows the version that matches the current wiki theme, so authors see what readers will see.
- Images without a dark version save and render exactly as they do today.

Out of scope for this spec: videos, inline images, cover images. Videos have no standard format and can follow once images ship.

## How?

### Saved format

Same as GitBook's Git Sync output, so GitHub and any HTML renderer also pick the right version:

```md
<picture>
  <source srcset="/files/shot-dark.png" media="(prefers-color-scheme: dark)">
  <img src="/files/shot.png" alt="Alt text">
</picture>
*Caption*
```

The caption keeps the existing `*caption*` line, so caption parsing and styling stay shared with plain images. An image with no dark version keeps saving as `![alt](src)`.

### Editor (frontend)

- `image-extension.js`: new `darkSrc` attribute. The block tokenizer also matches the `<picture>` form above and fills `src`, `darkSrc`, `alt`, `title`, `caption`.
- `image-markdown.js`: writes `<picture>` when `darkSrc` is set, otherwise the current `![alt](src)`.
- `ImageNodeView.vue`: picks `darkSrc` when `useTheme().resolvedTheme` is dark. Adds a frappe-ui `Dropdown` on the selected image with the four actions. Uploads reuse the editor's existing upload flow (`uploadFile`, loading overlay, upload blocking on submit).
- `WikiContentViewer.vue` gets this for free, because it renders through the same extension.

### Public pages (backend)

- markdown-it passes the `<picture>` HTML through as is (`html: True`).
- `<picture>` media queries follow the OS, while the wiki follows `data-theme`. A small script in `layout.html` rewrites each dark `<source>`'s `media` to `all` or `not all` from `data-theme`, and reruns when the theme toggles. The browser picks the new source without a reload.
- Caption CSS (`img + em`) gets a `picture + em` sibling rule in `wiki-rendered.css`, `main.css` and the print format.

## Phases

1. Markdown round trip: `darkSrc` attribute, tokenizer, serializer. Unit tests.
2. Editor UI: theme-aware node view, dropdown, upload for each mode.
3. Public render: theme sync script, caption CSS. Python test for `<picture>` pass-through.
4. E2E: add dark version, save, view published page in both themes.

## Progress

- [x] Phase 1
  - Tokenizer and serializer live in `image-markdown.js` so `node --test` can load them. `isVideoUrl` and `isPdfUrl` moved to `media-urls.js` for the same reason.
  - `darkSrc` round-trips through HTML as `data-dark-src`, so copy and paste inside the editor keeps it.
  - The `srcset` value gets spaces and commas percent-encoded, because `srcset` splits on both.
  - Only a `<picture>` with exactly one dark `<source>` and one `<img>` becomes an image. Any other `<picture>` falls to the editor's generic HTML handling, which escapes it. That escaping is existing behavior for all raw HTML blocks.
- [x] Phase 2
  - `WikiEditor` passes `uploadImage` to the image extension. It reuses `uploadFile` and blocks submit while it runs. The node keeps its current file until the new URL arrives, so a failed upload leaves the image as it was.
  - The menu shows only in the editor. `WikiContentViewer` passes no `uploadImage`, so it has no menu.
  - "Replace image" sets the light file and clears the dark one, so one file serves both modes.
  - Fixed along the way: a selected image drew two outlines, and the ring used an undefined `--primary`, so it was invisible in dark mode. It now uses `--ink-gray-9`.
- [x] Phase 3
  - markdown-it reads `<picture>` as a raw HTML block that runs to the next blank line, so the `*caption*` line was swallowed into it and showed as literal asterisks. A custom `html_block` renderer matches the exact shape the editor writes and emits `<p><picture>…</picture>\n<em>caption</em></p>`, the same shape as a plain image with a caption. Any other HTML block passes through unchanged, and a `<picture>` inside a code fence stays code.
  - Tailwind Typography puts the image margins on `picture`, not on the `img` inside it, so the caption rule is `picture:has(+ em)`.
  - `image-viewer.js` opens `currentSrc`, so zooming a dark image shows the dark file.
  - The theme sync script also reruns when SPA navigation swaps `#wiki-content`.
- [x] Phase 4
  - `e2e/tests/theme-aware-images.spec.ts`: an author uploads an image, adds a dark version through the menu (the real file chooser), adds a caption and publishes. The reader page shows the light file in a light wiki on a dark OS, the dark file after the theme toggle, the caption under the `<picture>`, and the dark file in the zoom viewer. A second test removes the dark version and checks the markdown goes back to `![](...)`.
  - With the theme sync script disabled, the reader test fails because a dark OS picks the dark file.
  - `makeUniquePng` moved from `webp-conversion.spec.ts` to `e2e/helpers/png.ts` and takes a colour, so both specs share it.

## Follow-up: Gameplan-style image options

### Why?

The image menu only replaced files. Authors also want to hide or show the caption, align the image and resize it, the way Gameplan does. The menu should look like Gameplan's too.

### What?

Select an image and two buttons appear on it, the same 28px dark buttons Gameplan uses:

- Top right: a `...` menu.
  - Caption: a switch that shows or hides the caption field. Turning it off clears the caption.
  - Align: Left, Center, Right. Center is the default.
  - Replace image: a submenu with For both modes, For light mode, For dark mode, and Remove dark mode image when one is set.
- Bottom right: a resize grip. Dragging it changes the width and keeps the aspect ratio.

The selected image gets Gameplan's soft ring (`ring-2 ring-outline-gray-3 ring-offset-2`) and `rounded-4` corners instead of the dark outline.

### How?

- Saved format: an image with a dark file, a width, or a left or right alignment saves as `<picture>`. The dark `<source>` is optional. The `<img>` carries `width="480"` and `data-align="left|right"` when set. frappe-ui's prose already styles `img[data-align]`. An image with none of these keeps saving as `![alt](src)`.
- `ImageNodeView.vue` mirrors frappe-ui's `MediaNodeView` and `MediaToolbar`. Those files are not exported, so the wiki keeps its own node view with the same classes and menu shape.
- `markdown.py` accepts the same `<picture>` shape with the optional source and attributes. The reader CSS aligns `img[data-align]` inside a `<picture>`.

### Phases

5. Markdown round trip for `width` and `align`. Unit and Python tests.
6. Node view: menu, caption switch, alignment, resize, ring.
7. Reader alignment CSS. E2E update.

### Progress

- [x] Phase 5
  - A `<picture>` with only an `<img>` is now an image too, so width and alignment reuse the same tokenizer and the same `markdown.py` renderer.
  - Width is rounded to whole pixels. Height is not saved: the image keeps its ratio with `height: auto`.
  - An unknown `data-align` is dropped in the editor and left as raw HTML by the reader.
- [x] Phase 6
  - The resize grip and every command go through `toRaw(props.editor)`. Through tiptap's reactive proxy, ProseMirror throws "Applying a mismatched transaction", which silently broke the resize and the caption's Enter and arrow keys. `CalloutBlockView` had the same bug on Enter in the title (fixed in its own commit, with an e2e test).
  - The frappe-ui menu renders the caption switch without an accessible name, so tests find it by the `switch` role.
  - The image border is gone in the editor and reader, and the radius is `--radius-4` (8px), as in Gameplan. Captions stay italic in the editor to match the reader's `<em>`.
- [x] Phase 7
  - Reader images are now centered, matching the editor. They used to sit left while their caption was centered.
  - A left or right aligned `<picture>` makes its `<p>` `fit-content`, so the caption stays under the image.
  - E2E: an author toggles the caption, aligns right, resizes with the grip and publishes; the reader shows the width, the caption and a right-aligned image.
- [x] Manual pass on a copy of a production wiki
  - Reader HTML is byte-identical to develop for all 6464 pages, and the editor's markdown round trip is identical on a sample of 35 media pages.
  - Fixed: clearing a saved caption hid its field mid-edit, and a caption brought back by undo after "Caption off" stayed hidden in the editor while still being published. The field now shows whenever the image has a caption, and stays open while the author edits it.
- [x] Review follow-ups
  - Two `<picture>` images with no blank line between them form one HTML block. The reader now renders each one with its caption, instead of passing the block through raw.
  - The PDF (wkhtmltopdf) had no image alignment, and its old WebKit has no `:has()`. An aligned picture's `<p>` now carries `data-align` too, so the reader and the print format share a plain `p[data-align]` rule.
