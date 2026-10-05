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

- `card_renderer()` returns `"chromium"`, `"satori"` or `None`. The satori check (`og_satori.available()`) runs once per process.
- `"satori"` needs `node` on `PATH` and `satori` and `@resvg/resvg-js` installed in the wiki app's `node_modules`.
- The renderer is part of the card fingerprint, so a site that moves from v15 to v16 redraws its cards in Chromium.
- `cards_supported()` becomes `card_renderer() is not None`. The tag, endpoint, warm-up and settings toggle already key off it.
- `generate_og_bytes()` picks the renderer. Everything around it (lock, failure cache, cache file, telemetry) stays as is.

### Node script (`wiki/og/og_satori.mjs`)

Read `{tree, width, height, fonts}` as JSON on stdin, write PNG bytes to stdout, exit non-zero with the error on stderr. Python calls it with `subprocess.run(["node", script], input=..., timeout=30)`. A timeout or non-zero exit raises, which lands in the existing failure path (`CardFailed`, negative cache, error log).

Python converts the PNG to JPEG with Pillow, so cache files stay `.jpg` and the endpoint keeps serving `image/jpeg`.

### Card layout (`og_satori.card_tree`)

satori supports a subset of CSS: flexbox only, inline styles only, no CSS variables, no `oklch()`. The card is the `og_image.html` layout written as satori's element tree (`{type, props: {style, children}}`) in Python, with hex colours.

- A tree, not HTML through `satori-html`. `satori-html` does not decode entities, so an escaped title printed `&amp;`. In a tree, text is plain data: nothing to escape and no markup to inject.
- The hex colours (`og_satori.COLORS`) are the same frappe-ui light-mode tokens. The token drift test converts each token's `oklch()` value to hex and checks them too.

### Images

Node never fetches anything. Every image goes in as a `data:` URI built in Python.

- Uploaded logo: read through its File doc (or from `sites/assets`, never outside it), converted to PNG with Pillow. resvg drops WebP without an error, and wiki converts uploads to WebP. An SVG logo passes through, sized from its `viewBox`. An unreadable logo is left out instead of failing every card in the space.
- Generated avatar: re-encoded as base64. It is stored percent-encoded, which satori's `btoa` rejects.
- Lucide icon: the SVG with its stroke colour written in, since `currentColor` does not reach into an `<img>`.

### Fonts and packages

- Inter SemiBold (600) and Medium (500) as static `.woff` in `wiki/public/fonts/`. satori cannot read the existing `Inter.var.woff2`.
- `satori` and `@resvg/resvg-js` go in the root `package.json` `dependencies`, beside the Tailwind CLI, which also runs on the server. CI gets them from `bench setup requirements --dev`, which runs `yarn install` in the app.

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
- [x] Phase 1: tracer bullet. A plain card through the real endpoint on the v15 bench: 200, `image/jpeg`, 1200x630, 1.2 s cold
- [x] Phase 2: full layout. Mark, breadcrumb, clamped title, footer, fonts, logo, avatar, icon
- [x] Phase 3: tests and CI. `wiki/api/test_og_satori.py`, drift check on the hex palette. The drift test had been skipping since frappe-ui moved `tailwind/generated/colors.json` to `tailwind/tokens/colors.js`; it now reads the new file
- [x] Phase 4: parity and telemetry. Chromium and satori side by side for an icon, an avatar, a WebP wordmark and a PNG logo: same layout and colours. The only visible difference is where the title's ellipsis falls (satori cuts mid-word). satori takes about 0.3 s per card, Chromium 0.6 to 2.2 s
- [x] v15 bench: server tests pass, and the generated-og-image E2E spec takes its "advertises a card" branch and passes
- [ ] Open questions: Frappe Cloud runtime and pilot pre-built assets
