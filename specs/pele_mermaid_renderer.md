# Render Mermaid diagrams with Pele

Date: 2026-10-18
Status: Implemented

## Why

The wiki renders ```` ```mermaid ```` fences with a vendored Mermaid 11.15.0 build (`wiki/public/js/vendor/mermaid/mermaid.min.js`). It is 3.3 MB raw (904 KB gzip), and it is slow. To fit our theme and avoid its quirks we keep a lot of glue code:

- converting oklch tokens to rgb on a canvas, because Mermaid's color engine cannot parse oklch
- re-rendering every diagram when the theme flips, through a `MutationObserver`
- waiting for web fonts before measuring labels
- removing the error container Mermaid leaves on `<body>`
- a module-level counter so render ids do not collide

[Pele](https://github.com/obsidianmd/pele) (MIT, by Obsidian) renders the same Mermaid syntax to SVG. It is synchronous, has no dependencies, and takes its colors from CSS variables.

## Benchmark

Headless Chromium, 8 diagram types, median of 7 cold runs.

| | Mermaid 11.15.0 | Pele 1.6.0 |
|---|---|---|
| Bundle (raw / gzip) | 3,313 KB / 904 KB | 682 KB / 252 KB |
| Load and init | 90 ms | 22 ms |
| First render, 8 diagrams | 329 ms | 53 ms |
| Re-render, 8 diagrams | 160 ms | 3.4 ms |
| 100-node flowchart | 302 ms | 44 ms |
| Editor keystroke | 28.9 ms | 0.8 ms |

On the real reader page (12 diagrams, real Chrome, median of 5 cold loads), after the theme work below:

| | Mermaid | Pele | Mermaid, 4x CPU | Pele, 4x CPU |
|---|---|---|---|---|
| Load until all diagrams drawn | 839 ms | 410 ms | 3071 ms | 1040 ms |
| Main thread blocked on load | 464 ms | 42 ms | 2289 ms | 339 ms |
| JS heap | 13.5 MB | 5.9 MB | | |
| Theme switch | 351 ms | 29 ms | 1435 ms | 40 ms |
| Editor keystroke | 39.4 ms | 1.0 ms | 172 ms | 4.7 ms |
| 100-node flowchart | 285 ms | 20 ms | 1188 ms | 62 ms |

Parity on the 548 examples in Mermaid's own syntax docs: Pele renders every example Mermaid 11.15.0 renders (0 regressions). It also renders 84 more that use newer diagram types.

## What

- Vendor `pele.global.js` 1.6.0 in `wiki/public/js/vendor/pele/`, and delete `vendor/mermaid/`.
- `mermaid-loader.js` loads Pele and exposes one mount function with our safety options. The editor and the public reader both use it, as they use the Mermaid loader today.
- Both sides use `pele.mount()`. It gives each diagram unique ids, re-measures after web fonts load, fits the diagram to its container width, adds zoom when a diagram is shrunk, and keeps the last good drawing (dimmed, with the error) when the source stops parsing.
- Theme: map the Frappe UI tokens to `--pele-*` variables in CSS. Light and dark switch with no re-render.
- Storage, markdown round-trip, and the server-side `<pre class="mermaid">` output do not change.

## Security

Keep parity with Mermaid's `securityLevel: "strict"`: no links and no images (`links: false, images: false`). Pele escapes text, drops `click` callbacks, and filters styles. Authors cannot pass render options.

## Decisions made while building

- `autoDirection: false`. Pele flips layouts to vertical below 640 px. The reader column is about 550 px, so every `flowchart LR` would have turned TD on desktop, and the editor preview would not match. Wide diagrams shrink to fit instead, as they did with Mermaid, and Pele adds zoom controls.
- No Mermaid fallback. The parity run found no diagram that Mermaid renders and Pele does not.
- Errors: the editor uses Pele's built-in error line, moved below the drawing so it does not cover legends. The old error strip and "Rendering…" placeholder are gone, since rendering is synchronous.
- Accent maps to `--ink-gray-7`. Blue tokens gave unreadable text on Gantt bars in dark mode.
- Chart series (pie, XY, mindmap, git graph) use frappe-ui's `--chart-categorical-*` ramp, in order, as frappe-ui charts do. The reader gets the ramp from `charts/style.css`, copied into the generated `frappe-ui-tokens.css`. The SPA imports that file directly, because `frappe-ui/charts` would pull ECharts into the editor.
- Pie labels: Pele prints them in one color. After each render, the loader inks each label from the slice under it, the way frappe-ui does: white on the dark (odd) slots, `--chart-inside-label` on the pale (even) ones.
- ER entities follow Frappe Insights' table cards (`TableNode.vue`): a raised card, a medium-weight name, hairlines between rows instead of zebra stripes, and relationship names in an outlined chip.
- The theme lives once in `wiki/public/css/diagrams.css`, imported by both `main.css` and the SPA's `index.css`.

## Phases

1. Public reader: vendor Pele, rewrite the loader and `mermaid-renderer.js`, map the theme variables in `main.css`.
2. Editor and SPA read-only view: `MermaidBlockView.vue` mounts through the shared loader and drops the theme watch, render ids, and font wait.
3. Tests: update the e2e spec and add coverage for theme switching and the syntax error display.

## Progress

- [x] Phase 1: public reader renders with Pele, light and dark, LR kept, wide diagrams zoomable, inline errors.
- [x] Phase 2: editor preview and change-request preview mount through the shared loader.
- [x] Phase 3: e2e covers the editor error state and live theme switching. The theme test fails on the Mermaid code (diagram redrawn) and passes on Pele.
