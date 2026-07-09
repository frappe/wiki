# Public Reader prose-v3 Typography Parity

Date: 2026-07-09
Status: In progress. Follow-up flagged in `specs/frappe_ui_v1_upgrade.md` (2026-07-09 entry). Lives on `feat/frappe-ui-v1`.

## Problem

The SPA editor now renders content with frappe-ui's stock `prose prose-v3` typography (EditorContent default, adopted in the markdown-format refactor). The public reader still uses ~200 lines of hand-written `.prose` / `.prose-sm` rules in `wiki/public/css/main.css` — a copy of the *old* editor look. Same page, two different renderings, and every upstream typography change from here on widens the drift.

## Approach — reuse, don't copy

frappe-ui's own docs never copy typography: they run Tailwind with `presets: [frappe-ui/tailwind]` and safelist `prose prose-v3`, so tokens and prose styles come straight from the plugin source (`~/Frappe/frappe-ui/tailwind.config.js`).

The reader can't do exactly that — its pipeline is Tailwind **v4** (CSS-first) while frappe-ui's preset/typography is a Tailwind **v3** plugin. But the repo already solved this shape for color tokens: `scripts/generate-public-theme.mjs` emits `wiki/public/css/frappe-ui-tokens.css` (gitignored) from frappe-ui's source JSONs during `yarn tailwind:build`.

Same pattern for typography, except **zero reimplementation**: run the *real* Tailwind v3 + frappe-ui preset (both already in `frontend/node_modules`) with an empty content set and `safelist: ['prose', 'prose-v3']`, and capture the emitted component CSS. Output: `wiki/public/css/frappe-ui-prose.css` (gitignored). Byte-for-byte the same `.prose` / `.prose-v3` rules the SPA gets.

### Mechanics / gotchas

- frappe-ui's `tailwind/plugin.js` is ESM with bare JSON imports — plain node can't load it, but the Tailwind v3 CLI's jiti config-loader can. That's why we shell out to `frontend/node_modules/.bin/tailwindcss` instead of importing the preset in a node script.
- Run the CLI from the **repo root**: `frontend/postcss.config.js` declares the tailwindcss plugin, and the v3 CLI auto-loads a discovered postcss config → double-processing. Repo root has no postcss config.
- The generator config imports the preset by explicit path (`frontend/node_modules/frappe-ui/tailwind`) because the repo root `node_modules` doesn't have frappe-ui.
- `corePlugins: { preflight: false }`, entry css = `@tailwind components;` only — we want just the prose component rules.
- Remove `@plugin '@tailwindcss/typography'` from `main.css` — the generated file fully defines `.prose`; leaving the v4 typography plugin in would emit a second, conflicting `.prose`.

## Changes

1. `scripts/generate-public-prose.mjs` — spawns the v3 CLI with `scripts/prose.tailwind.config.mjs` + `scripts/prose-entry.css`, writes `wiki/public/css/frappe-ui-prose.css`. Wired into `theme:generate` in package.json; output gitignored like `frappe-ui-tokens.css`.
2. `wiki/public/css/main.css` — import the generated file; delete the hand-written prose typography (var mapping block, `.prose-sm` sizes/headings/margins, `.prose a` underline rules, inline-code pill rules). Keep reader-specific chrome: code-block shell + toolbar, mermaid figure, callouts, heading anchors, lightbox, image caption, table borders, PDF card.
3. `wiki/templates/wiki/document.html` — content div `prose prose-sm` → `prose prose-v3` (mirrors EditorContent's default classes).

Out of scope: hljs theme parity (frappe-ui's code-block CSS is scoped to `.ProseMirror`; reader keeps `hljs-github-light.css` and its own shell), reader font-size tuning (prose-v3's 15px default is the out-of-box look, same as the editor).

## Verification

- `yarn tailwind:build` green; generated file contains `.prose` + `.prose-v3` rules referencing `--ink-*` vars (dark mode flips via tokens, no extra work).
- Public page screenshots light + dark: headings, lists, inline code pill, blockquote, links (border-bottom style), tables, task-list checkboxes.
- e2e: public-pages + mermaid public-route specs green.

## Progress log

- 2026-07-09: Spec written after researching frappe-ui docs wiring (`tailwind.config.js` preset + safelist) and the reader pipeline.
