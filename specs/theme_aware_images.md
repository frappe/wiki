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
- [ ] Phase 3
- [ ] Phase 4
