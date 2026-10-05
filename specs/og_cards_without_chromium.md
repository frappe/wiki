# OG cards without Chromium

Builds on [frappe_v15_compat.md](frappe_v15_compat.md) and [generated_meta_images.md](generated_meta_images.md).

## Why?

Auto-generated OG cards render through `frappe.utils.preview`, which drives the headless Chromium that ships with Frappe v16. Frappe v15 has neither, so the v15 compatibility work turns cards off there. Every page on a v15 site then shares as a plain link with no image, unless someone uploads a meta image by hand.

## What?

On a site without `frappe.utils.preview`, render the same card with [satori](https://github.com/vercel/satori) (HTML to SVG) and [resvg](https://github.com/yisibl/resvg-js) (SVG to PNG) in a short Node script.

- Same card as today: space mark, breadcrumb, title clamped to three lines, space name.
- Same plumbing: endpoint, file cache, fingerprint, render lock, failure cache, warm-up job, Wiki Settings toggle.
- Renderer order: Chromium when `frappe.utils.preview` exists, else satori when Node and its packages are present, else cards stay off as they are now.

Out of scope: replacing Chromium on v16+. If satori cards match Chromium closely, a single renderer can be a later decision.

### Why satori over Pillow

Pillow needs no new dependency, but the wiki card is mostly what Pillow handles worst:

| Card element | Pillow | satori + resvg |
|---|---|---|
| Lucide icon and generated avatar (both SVG) | Cannot draw SVG without another rasteriser | Draws them |
| Title clamped to three lines with an ellipsis | Hand-written wrapping | `lineClamp: 3` |
| Breadcrumb ellipsis | Hand-written | `text-overflow: ellipsis` |
| Layout | A second, imperative layout | Close to the existing HTML |

A prototype rendered the wiki layout correctly in about 0.5 s and 138 MB per card. Cards are cached and warmed, so that cost is paid once per change.

## How?

### Renderer selection (`wiki/api/og_image.py`)

- `card_renderer()` returns `"chromium"`, `"satori"` or `None`. It is checked once per process.
- `"satori"` needs `node` on `PATH` and `satori`, `satori-html` and `@resvg/resvg-js` resolvable from the wiki app root.
- `cards_supported()` becomes `card_renderer() is not None`. The tag, endpoint, warm-up and settings toggle already key off it.
- `generate_og_bytes()` picks the renderer. Everything around it (lock, failure cache, cache file, telemetry) stays as is.

### Node script (`wiki/og/og_satori.mjs`)

Read `{html, width, height, fonts}` as JSON on stdin, write PNG bytes to stdout, exit non-zero with the error on stderr. Python calls it with `subprocess.run(["node", script], input=..., timeout=30)`. A timeout or non-zero exit raises, which lands in the existing failure path (`CardFailed`, negative cache, error log).

Python converts the PNG to JPEG with Pillow, so cache files stay `.jpg` and the endpoint keeps serving `image/jpeg`.

### Template (`wiki/templates/wiki/og_image_satori.html`)

satori supports a subset of CSS: flexbox only, inline styles only, no `<style>` block, no CSS variables, no `oklch()`. So this is a sibling of `og_image.html` with the same layout, inline styles and hex colours.

- The hex colours are the same frappe-ui light-mode tokens. The token drift test converts each token's `oklch()` value to hex and checks the satori template too.
- Same escaping rule as today: every interpolation keeps `| e`.

### Images

Node never fetches anything. Every image goes in as a `data:` URI built in Python.

- Uploaded logo: read through its File doc, converted to PNG with Pillow (satori 0.10 cannot decode WebP, and wiki converts uploads to WebP).
- Generated avatar: already an SVG `data:` URI.
- Lucide icon: the SVG with its stroke colour written in, since `currentColor` does not reach into an `<img>`.

### Fonts and packages

- Inter SemiBold (600) and Medium (500) as static `.woff` in `wiki/public/fonts/`. satori cannot read the existing `Inter.var.woff2`.
- `satori`, `satori-html` and `@resvg/resvg-js` go in the root `package.json` `dependencies`, beside the Tailwind CLI, which also runs on the server.

### Telemetry

`meta_image_generated` gains `renderer` (`chromium` or `satori`), added to the event catalogue in `docs/telemetry.md`.

## Open questions

- **Frappe Cloud runtime.** frappe's official production image keeps Node on `PATH` and copies the bench, including apps' `node_modules`. Confirm the same on Frappe Cloud before release.
- **Pre-built assets.** develop now declares `[tool.bench.assets]` for pre-built assets (frappe/pilot). If benches stop running `yarn install` for the app, the satori packages will not be on the server. Confirm how pilot installs runtime `dependencies`, or vendor a bundled script.

## Testing

- Unit: renderer selection; the satori path returns a 1200x630 JPEG; WebP logo; coloured lucide icon; a timeout or a failed Node exit lands in `CardFailed`. Render tests skip when Node or the packages are missing; CI installs them.
- Token drift: the satori template's hex values match frappe-ui.
- Visual: the same pages rendered by Chromium (v16) and satori side by side, checked by eye for parity.
- E2E: on v15 the generated-og-image spec takes its "advertises a card" branch again.
- Cost: render time and peak memory per card, cold and warm.

## Plan (tracer bullets)

1. A plain satori card (title only) rendered through the real endpoint on the v15 bench. Proves every layer: selection, Node call, PNG to JPEG, cache, serving.
2. Full layout: mark, breadcrumb, clamped title, footer, fonts, images.
3. Tests, drift check, CI dependencies.
4. Visual parity with Chromium, telemetry, the two open questions.

## Progress

- [x] Compared Pillow with satori, prototyped the wiki layout in satori
- [ ] Phase 1: tracer bullet
- [ ] Phase 2: full layout
- [ ] Phase 3: tests and CI
- [ ] Phase 4: parity, telemetry, open questions
