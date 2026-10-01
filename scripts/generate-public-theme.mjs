#!/usr/bin/env node
/**
 * Generate the public-page design tokens from frappe-ui's token source.
 *
 * The SPA gets frappe-ui tokens through the Tailwind v3 preset
 * (frappe-ui/tailwind). The public reader (wiki/templates, server-rendered)
 * runs a separate Tailwind v4 pipeline that used to carry a hand-copied
 * snapshot of the tokens — which drifted. This script reads frappe-ui's own
 * token module and emits a Tailwind v4 stylesheet, so both surfaces share one
 * source of truth: upgrade frappe-ui, rebuild, done.
 *
 * `frappe-ui/tailwind/tokens` (beta.76 and up) publishes the tokens as data,
 * including `cssVariables`, the same variable blocks the v3 plugin writes. We
 * used to mirror colorPalette.js and plugin.js by hand to get them; the mirror
 * is gone. What is left is the v4 shaping the preset does not do for us:
 * `@theme` scales and the merged `@utility` text styles.
 *
 * Input:  frontend/node_modules/frappe-ui/tailwind/tokens.js
 * Output: wiki/public/css/frappe-ui-tokens.css
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'frontend/node_modules/frappe-ui');
const outFile = join(root, 'wiki/public/css/frappe-ui-tokens.css');

const {
	colors,
	cssVariables,
	focusRing,
	fontSize,
	fontWeight,
	radius,
	shadows,
	tracking,
} = await import(pathToFileURL(join(packageDir, 'tailwind/tokens.js')).href);

const frappeUiVersion = JSON.parse(
	readFileSync(join(packageDir, 'package.json'), 'utf8'),
).version;

function block(selector, vars) {
	const lines = Object.entries(vars).map(
		([name, value]) => `\t${name}: ${value};`,
	);
	return `${selector} {\n${lines.join('\n')}\n}`;
}

// --- @theme scales ---------------------------------------------------------

function radiusThemeVars() {
	return Object.fromEntries(
		Object.entries(radius).map(([key, value]) => [`--radius-${key}`, value]),
	);
}

function shadowThemeVars() {
	return Object.fromEntries(
		Object.entries(shadows).map(([key, value]) => [
			key === 'DEFAULT' ? '--shadow' : `--shadow-${key}`,
			value,
		]),
	);
}

// The v4 equivalent of the preset's font-size scale: one var per size, plus
// the modifier vars v4 reads for line height, tracking and weight.
function fontSizeThemeVars() {
	const out = {};
	for (const [key, style] of Object.entries(fontSize)) {
		out[`--text-${key}`] = style.fontSize;
		out[`--text-${key}--line-height`] = style.lineHeight;
		out[`--text-${key}--letter-spacing`] = style.letterSpacing;
		out[`--text-${key}--font-weight`] = style.fontWeight;
	}
	return out;
}

function colorThemeVars() {
	const out = {};
	for (const [color, shades] of Object.entries(colors.light)) {
		for (const [shade, value] of Object.entries(shades)) {
			out[`--color-${color}-${shade}`] = value;
		}
	}
	for (const [tone, shades] of Object.entries(colors.overlay)) {
		for (const [shade, value] of Object.entries(shades)) {
			out[`--color-${tone}-overlay-${shade}`] = value;
		}
	}
	return out;
}

// --- @utility text styles --------------------------------------------------

// `text-base-medium` and friends: one class that sets size, line height,
// weight and the weight's own tracking, which the scale above cannot express.
function textStyleUtilities() {
	const out = [];
	const groups = [
		{ prefix: '', tracking: tracking.text },
		{ prefix: 'p-', tracking: tracking.paragraph },
	];
	for (const group of groups) {
		for (const [size, byWeight] of Object.entries(group.tracking)) {
			const style = fontSize[`${group.prefix}${size}`];
			if (!style) continue;
			for (const [weight, letterSpacing] of Object.entries(byWeight)) {
				if (weight === 'regular') continue;
				out.push(
					block(`@utility text-${group.prefix}${size}-${weight}`, {
						'font-size': style.fontSize,
						'line-height': style.lineHeight,
						'font-weight': String(fontWeight[weight]),
						'letter-spacing': letterSpacing,
					}),
				);
			}
		}
	}
	return out;
}

function focusRingUtilities() {
	return Object.keys(focusRing.light).map((name) =>
		block(
			`@utility ${name === 'default' ? 'focus-ring' : `focus-ring-${name}`}`,
			{
				outline: `var(--focus-outline-${name})`,
				'outline-offset': '0px',
			},
		),
	);
}

// --- Assemble ---------------------------------------------------------------

const css = [
	`/* GENERATED FILE — DO NOT EDIT.
 * Source: frappe-ui@${frappeUiVersion} tailwind tokens
 * (frontend/node_modules/frappe-ui/tailwind/tokens.js). Regenerate with:
 *   node scripts/generate-public-theme.mjs
 * (runs automatically as part of \`yarn tailwind:build\`)
 */`,
	block('@theme', {
		...radiusThemeVars(),
		...shadowThemeVars(),
		...fontSizeThemeVars(),
		...colorThemeVars(),
	}),
	block(':root', cssVariables.light),
	block('[data-theme="dark"]', cssVariables.dark),
	...textStyleUtilities(),
	...focusRingUtilities(),
].join('\n\n');

writeFileSync(outFile, `${css}\n`);
console.log(
	`Wrote ${outFile.replace(`${root}/`, '')} from frappe-ui@${frappeUiVersion}`,
);
