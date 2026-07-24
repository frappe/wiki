#!/usr/bin/env node
/**
 * Generate the public reader's prose typography from frappe-ui's source.
 *
 * The SPA editor renders content with frappe-ui's `prose prose-v3` classes
 * (EditorContent's defaults, from the @tailwindcss/typography config in
 * frappe-ui/tailwind/plugin.js). The reader used to carry a hand-written
 * copy of the old editor look in main.css — which drifted.
 *
 * Rather than reimplement the typography config, run the real Tailwind v3
 * CLI (frontend/node_modules) with the frappe-ui preset, no content, and
 * `safelist: ['prose', 'prose-v3']` — capturing byte-for-byte the same
 * component rules the SPA gets. The v3 CLI's jiti config loader is what
 * makes the preset's ESM/JSON imports loadable (plain node cannot).
 *
 * Runs from the repo root on purpose: frontend/postcss.config.js declares
 * the tailwindcss plugin, and the v3 CLI auto-loads a discovered postcss
 * config, double-processing the input. The repo root has no postcss config.
 *
 * Output: wiki/public/css/frappe-ui-prose.css (gitignored, consumed by
 * main.css's Tailwind v4 pipeline as plain CSS).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tailwindBin = join(root, 'frontend/node_modules/.bin/tailwindcss');
const outFile = join(root, 'wiki/public/css/frappe-ui-prose.css');
const codeBlockSrc = join(
	root,
	'frontend/node_modules/frappe-ui/src/molecules/editor/extensions/code-block/CodeBlockComponent.css',
);
const codeOutFile = join(root, 'wiki/public/css/frappe-ui-code.css');

if (!existsSync(tailwindBin)) {
	console.error(
		'generate-public-prose: frontend/node_modules/.bin/tailwindcss not found — run yarn install in frontend/ first.',
	);
	process.exit(1);
}

execFileSync(
	tailwindBin,
	[
		'-c',
		join(root, 'scripts/prose.tailwind.config.mjs'),
		'-i',
		join(root, 'scripts/prose-entry.css'),
		'-o',
		outFile,
	],
	{ cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
);

console.log('generate-public-prose: wrote wiki/public/css/frappe-ui-prose.css');

// Code blocks: frappe-ui's editor CodeBlock ships its pre shell + the GitHub
// light/dark highlight.js theme as plain CSS scoped to `.ProseMirror`. The
// reader highlights with client-side hljs too (same `.hljs-*` classes), so a
// scope rewrite to `.prose` gives the public page the exact editor look.
const codeCss = readFileSync(codeBlockSrc, 'utf8').replaceAll(
	'.ProseMirror',
	'.prose',
);
writeFileSync(
	codeOutFile,
	`/* Generated from frappe-ui CodeBlockComponent.css (scope .ProseMirror → .prose)
   by scripts/generate-public-prose.mjs — do not edit. */
${codeCss}`,
);
console.log('generate-public-prose: wrote wiki/public/css/frappe-ui-code.css');
