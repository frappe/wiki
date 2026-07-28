#!/usr/bin/env node
/**
 * Generate the public-page design tokens from frappe-ui's token source.
 *
 * The SPA gets frappe-ui tokens through the Tailwind v3 preset
 * (frappe-ui/tailwind). The public reader (wiki/templates, server-rendered)
 * runs a separate Tailwind v4 pipeline that used to carry a hand-copied
 * snapshot of the tokens — which drifted. This script reads the same
 * Figma-synced JSON the preset reads and emits a Tailwind v4 stylesheet, so
 * both surfaces share one source of truth: upgrade frappe-ui, rebuild, done.
 *
 * Mirrors frappe-ui/tailwind/colorPalette.js + plugin.js (which node can't
 * import directly — they use bare JSON imports). Emits:
 *   - @theme: radius, shadows (elevation), font sizes with v4 modifier vars,
 *     and the raw color palette (--color-*)
 *   - :root / [data-theme="dark"]: the semantic variables (--surface-*,
 *     --ink-*, --outline-*), raw palette vars, elevation + focus vars
 *   - @utility: text-<size>-<weight> merged text styles and focus-ring-*
 *     (purgeable — only the ones templates use reach tailwind.css)
 *
 * Input:  frontend/node_modules/frappe-ui/tailwind/colors.json (live oklch
 *         tokens — NOT generated/colors.json, which is a stale hex export)
 *         + frontend/node_modules/frappe-ui/tailwind/generated/{radius,
 *         typography,effects}.json
 * Output: wiki/public/css/frappe-ui-tokens.css
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokenDir = join(root, 'frontend/node_modules/frappe-ui/tailwind');
const outFile = join(root, 'wiki/public/css/frappe-ui-tokens.css');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const colors = readJson(join(tokenDir, 'colors.json'));
const radius = readJson(join(tokenDir, 'generated/radius.json'));
const typography = readJson(join(tokenDir, 'generated/typography.json'));
const effects = readJson(join(tokenDir, 'generated/effects.json'));
const frappeUiVersion = readJson(
	join(root, 'frontend/node_modules/frappe-ui/package.json'),
).version;

// Mirrors colorPalette.js#resolveColorReference.
function resolveColorReference(reference) {
	const [mode, color, shade] = reference.split('/');
	if (mode === 'lightMode') return colors.lightMode[color][shade];
	if (mode === 'darkMode') return colors.darkMode[color][shade];
	if (mode === 'overlay') return colors.overlay[color][shade];
	if (mode === 'neutral') return colors.neutral[color];
	throw new Error(`Unresolvable color reference: ${reference}`);
}

function block(selector, vars, indent = '') {
	const lines = Object.entries(vars).map(
		([name, value]) => `${indent}\t${name}: ${value};`,
	);
	return `${indent}${selector} {\n${lines.join('\n')}\n${indent}}`;
}

// --- Semantic variables (mirrors colorPalette.js#generateCSSVariables) ----

function semanticVars(mode) {
	const out = {};
	for (const [category, entries] of Object.entries(
		colors.themedVariables[mode],
	)) {
		for (const [name, reference] of Object.entries(entries)) {
			out[`--${category}-${name}`] = resolveColorReference(reference);
		}
	}
	return out;
}

function paletteVars(mode, prefix = '') {
	const out = {};
	for (const [color, shades] of Object.entries(colors[mode])) {
		for (const [shade, value] of Object.entries(shades)) {
			out[`--${prefix}${color}-${shade}`] = value;
		}
	}
	return out;
}

// --- Effects (mirrors colorPalette.js#generateEffectVariables) ------------

function shadowToOutline(shadow) {
	const parts = shadow.trim().split(/\s+/);
	return `${parts[3]} solid ${parts.slice(4).join(' ')}`;
}

function effectVars(mode) {
	const out = {};
	if (mode === 'light') {
		// Elevation uses the light values in both modes (matches Figma).
		for (const [step, value] of Object.entries(effects.elevation.light)) {
			out[`--elevation-${step}`] = value;
		}
		for (const [name, value] of Object.entries(effects.elevation.custom)) {
			out[`--elevation-${name}`] = value;
		}
	}
	for (const [name, value] of Object.entries(effects.focus[mode])) {
		out[`--focus-${name}`] = value;
		out[`--focus-outline-${name}`] = shadowToOutline(value);
	}
	return out;
}

// --- @theme scales ---------------------------------------------------------

function radiusThemeVars() {
	const out = {};
	for (const [key, value] of Object.entries(radius)) {
		if (key === 'DEFAULT') out['--radius'] = value;
		else out[`--radius-${key}`] = value;
	}
	return out;
}

function shadowThemeVars() {
	const out = { '--shadow-none': 'none' };
	for (const [step, value] of Object.entries(effects.elevation.light)) {
		if (step === 'base') out['--shadow'] = value;
		else out[`--shadow-${step}`] = value;
	}
	for (const [name, value] of Object.entries(effects.elevation.custom)) {
		out[`--shadow-${name}`] = value;
	}
	return out;
}

// Regular + paragraph sizes as v4 `--text-*` vars with modifier vars, the v4
// equivalent of plugin.js#buildFontSize.
function fontSizeThemeVars() {
	const out = {};
	const emit = (key, size, meta) => {
		out[`--text-${key}`] = size;
		if (meta.lineHeight) out[`--text-${key}--line-height`] = meta.lineHeight;
		if (meta.letterSpacing)
			out[`--text-${key}--letter-spacing`] = meta.letterSpacing;
		if (meta.fontWeight) out[`--text-${key}--font-weight`] = meta.fontWeight;
	};
	for (const [key, [size, meta]] of Object.entries(typography.fontSize)) {
		emit(key, size, meta);
	}
	for (const [key, p] of Object.entries(typography.paragraph || {})) {
		const entry = typography.fontSize[key];
		if (!entry) continue;
		const [size, meta] = entry;
		emit(`p-${key}`, size, { ...meta, ...p });
	}
	return out;
}

function colorThemeVars() {
	const out = {};
	for (const [color, shades] of Object.entries(colors.lightMode)) {
		for (const [shade, value] of Object.entries(shades)) {
			out[`--color-${color}-${shade}`] = value;
		}
	}
	for (const [shade, value] of Object.entries(colors.overlay.white)) {
		out[`--color-white-overlay-${shade}`] = value;
	}
	for (const [shade, value] of Object.entries(colors.overlay.black)) {
		out[`--color-black-overlay-${shade}`] = value;
	}
	return out;
}

// --- @utility text styles (mirrors plugin.js#buildTextStyleUtilities) ------

const WEIGHT_VARIANTS = ['medium', 'semibold', 'bold', 'black'];

function textStyleUtilities() {
	const out = [];
	const t = typography;
	const groups = [
		{
			className: (s, w) => `text-${s}-${w}`,
			tracking: t.tracking?.text || {},
			lineHeight: (s) => t.fontSize[s]?.[1].lineHeight,
		},
		{
			className: (s, w) => `text-p-${s}-${w}`,
			tracking: t.tracking?.paragraph || {},
			lineHeight: (s) => t.paragraph?.[s]?.lineHeight,
		},
	];
	for (const group of groups) {
		for (const [size, byWeight] of Object.entries(group.tracking)) {
			const entry = t.fontSize[size];
			if (!entry) continue;
			const [fontSize] = entry;
			const lineHeight = group.lineHeight(size);
			const transform = t.textTransform?.[size];
			for (const weight of WEIGHT_VARIANTS) {
				if (!(weight in byWeight)) continue;
				const props = {
					'font-size': fontSize,
					'line-height': lineHeight,
					'font-weight': String(t.fontWeight[weight]),
					'letter-spacing': byWeight[weight],
					...(transform ? { 'text-transform': transform } : {}),
				};
				out.push(block(`@utility ${group.className(size, weight)}`, props));
			}
		}
	}
	return out;
}

function focusRingUtilities() {
	return Object.keys(effects.focus.light).map((name) => {
		const className = name === 'default' ? 'focus-ring' : `focus-ring-${name}`;
		return block(`@utility ${className}`, {
			outline: `var(--focus-outline-${name})`,
			'outline-offset': '0px',
		});
	});
}

// --- Assemble ---------------------------------------------------------------

const css = [
	`/* GENERATED FILE — DO NOT EDIT.
 * Source: frappe-ui@${frappeUiVersion} tailwind tokens
 * (frontend/node_modules/frappe-ui/tailwind). Regenerate with:
 *   node scripts/generate-public-theme.mjs
 * (runs automatically as part of \`yarn tailwind:build\`)
 */`,
	block('@theme', {
		...radiusThemeVars(),
		...shadowThemeVars(),
		...fontSizeThemeVars(),
		...colorThemeVars(),
	}),
	block(':root', {
		...semanticVars('light'),
		...paletteVars('lightMode'),
		...effectVars('light'),
		...radiusThemeVars(),
	}),
	block('[data-theme="dark"]', {
		...semanticVars('dark'),
		...paletteVars('darkMode', 'dark-'),
		...effectVars('dark'),
	}),
	...textStyleUtilities(),
	...focusRingUtilities(),
].join('\n\n');

writeFileSync(outFile, `${css}\n`);
console.log(
	`Wrote ${outFile.replace(`${root}/`, '')} from frappe-ui@${frappeUiVersion}`,
);
