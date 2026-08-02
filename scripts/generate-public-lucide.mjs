#!/usr/bin/env node
/**
 * Generate the public reader's lucide icon table.
 *
 * The SPA gets `lucide-*` utilities from frappe-ui's Tailwind v3 plugin
 * (lucideIconsPlugin -> iconPackPlugin), which the reader's separate Tailwind
 * v4 pipeline can't load. Without them a tab icon stored on the document
 * renders as an empty box on public pages.
 *
 * The reader inlines the SVG server-side instead (see wiki.utils.lucide_svg):
 * a page shows a handful of tabs, so a few hundred bytes of inline markup
 * beats shipping ~200KB of masked-background CSS on every request.
 *
 * Scope is the curated TAB_ICONS list the icon picker offers — the same list
 * that acts as the SPA's Tailwind safelist — plus CHROME_ICONS below, the
 * fixed set the reader's own chrome draws (see macros/buttons.html).
 *
 * Input:  frontend/src/lib/tabIcons.js + frontend/node_modules/lucide-static
 * Output: wiki/lucide_icons.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'frontend/node_modules/'));
const iconsDir = join(
	dirname(require.resolve('lucide-static/package.json')),
	'icons',
);

// Lucide ships at stroke-width 2; frappe-ui normalises to 1.5. Match it so the
// reader's icons weigh the same as the editor's.
const STROKE_WIDTH = 1.5;

// Parsed rather than imported: keeping this a text scan means the script never
// pulls Vue-land modules into node.
const source = readFileSync(join(root, 'frontend/src/lib/tabIcons.js'), 'utf8');
const classes = [...source.matchAll(/class:\s*'(lucide-[a-z0-9-]+)'/g)].map(
	(m) => m[1],
);

// The fallback SpaceIcon.vue uses for a missing/unknown icon.
const EXTRA = ['lucide-hash'];

// Icons the reader's chrome draws itself — navbar, sidebar, search palette,
// page actions. These were hand-copied SVGs before, and most of them had
// drifted to Heroicons geometry (a circle-arc magnifier instead of lucide's
// circle + stub, a 4-bar list instead of lucide's dotted one), so the reader
// and the frappe-ui docs it mirrors drew visibly different icons. Generating
// them from the same pack the SPA uses is the only way they stay identical.
//
// Brand marks (GitHub, Discord, X, …) are deliberately absent: lucide dropped
// its brand icons, so those stay hand-written in macros/buttons.html — the
// same thing frappe-ui's own docs navbar does with its GitHub mark.
const CHROME_ICONS = [
	'lucide-arrow-down',
	'lucide-arrow-left',
	'lucide-arrow-right',
	'lucide-arrow-up',
	'lucide-check',
	'lucide-chevron-down',
	'lucide-chevron-left',
	'lucide-chevron-right',
	'lucide-chevrons-up-down',
	'lucide-clipboard',
	'lucide-command',
	'lucide-corner-down-left',
	'lucide-download',
	'lucide-external-link',
	'lucide-file-text',
	'lucide-list',
	'lucide-loader',
	'lucide-menu',
	'lucide-moon',
	'lucide-moon-star',
	'lucide-panel-right-open',
	'lucide-pencil',
	'lucide-search',
	'lucide-sparkles',
	'lucide-sun',
	'lucide-x',
];

// Only the inner markup is stored; wiki.utils.lucide_svg wraps it in an <svg>
// carrying the caller's classes, so sizing stays a template concern.
function innerMarkup(className) {
	const name = className.replace(/^lucide-/, '');
	const file = join(iconsDir, `${name}.svg`);
	if (!existsSync(file)) {
		console.warn(`generate-public-lucide: no such icon "${name}", skipping`);
		return null;
	}
	return readFileSync(file, 'utf8')
		.replace(/^[\s\S]*?<svg[^>]*>/, '')
		.replace(/<\/svg>\s*$/, '')
		.replace(/stroke-width="[^"]+"/g, `stroke-width="${STROKE_WIDTH}"`)
		.replace(/\s+/g, ' ')
		.trim();
}

const table = {};
for (const className of [
	...new Set([...classes, ...EXTRA, ...CHROME_ICONS]),
].sort()) {
	const inner = innerMarkup(className);
	if (inner) table[className] = inner;
}

const target = join(root, 'wiki/lucide_icons.json');
writeFileSync(target, `${JSON.stringify(table, null, '\t')}\n`);
const count = Object.keys(table).length;
console.log(`generate-public-lucide: wrote ${count} icons -> ${target}`);
