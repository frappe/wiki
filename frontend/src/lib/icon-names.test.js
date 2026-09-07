import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * frappe-ui 1.0.0 removed FeatherIcon and its bare-name back-compat (ADR-0008):
 * an icon string that does not start with `lucide-` resolves to nothing. The
 * component renders null and logs one dev warning per component+prop, so a
 * stale name is invisible in CI and in a production build — it just draws
 * nothing.
 *
 * That has now bitten twice: once across 41 call sites during the beta.45
 * upgrade, and again on `icon: node.is_published ? 'eye-off' : 'eye'`, which a
 * grep for `icon: '...'` did not match because the value sits in a ternary.
 * This scans every source file for any string literal reachable from an
 * icon-ish key or prop, in whatever syntactic form.
 */

const SRC = path.resolve(import.meta.dirname, '..');

/**
 * An `icon:` object key, or an `icon=` / `:icon-left=` template prop. The
 * lookbehind keeps a hyphenated name ending in "icon" out — `@update-icon="…"`
 * is an event, not an icon prop.
 *
 * The key pattern is case-sensitive and the prop pattern is not, on purpose: a
 * key is always lowercase-initial (`icon`, `iconLeft`), while an uppercase one
 * is a component tag before a bound prop — `<IconGrid :model-value="icon">`
 * read as an `Icon…:` key and reported its own binding as a stale name.
 */
const ICON_KEY = /(?<![-\w])icon\w*\s*:(?!:)/;
const ICON_PROP = /(?<![-\w])(?::)?icon(?:-left|-right|Left|Right)?\s*=/i;
const STRING_LITERAL = /['"`]([^'"`\n]*)['"`]/g;

/**
 * The icon value's own expression, not the rest of the line — otherwise a
 * `variant="subtle"` or `class="shrink-0"` sitting beside the icon prop reads
 * as an icon name.
 */
function iconExpressions(line) {
	const out = [];

	const prop = ICON_PROP.exec(line);
	if (prop) {
		// Attribute form: the value is exactly the next quoted string. For a
		// binding (`:icon="expr"`) that string is the expression, whose own
		// literals are the candidates.
		const rest = line.slice(prop.index + prop[0].length);
		const quoted = /^\s*(['"])(.*?)\1/.exec(rest);
		if (quoted) out.push(quoted[2]);
	}

	const key = ICON_KEY.exec(line);
	if (key) {
		// Object form: up to the first comma outside quotes, so a ternary's
		// branches are included but the next property is not.
		const rest = line.slice(key.index + key[0].length);
		let quote = null;
		let end = rest.length;
		for (let i = 0; i < rest.length; i++) {
			const c = rest[i];
			if (quote) {
				if (c === quote) quote = null;
			} else if (c === "'" || c === '"' || c === '`') quote = c;
			else if (c === ',') {
				end = i;
				break;
			}
		}
		out.push(rest.slice(0, end));
	}

	return out;
}

function sourceFiles(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (
			/\.(vue|js|ts)$/.test(entry.name) &&
			!entry.name.endsWith('.test.js')
		)
			out.push(full);
	}
	return out;
}

test('every icon string is a lucide- class', () => {
	const offenders = [];

	for (const file of sourceFiles(SRC)) {
		const lines = fs.readFileSync(file, 'utf8').split('\n');
		for (const [i, line] of lines.entries()) {
			for (const expression of iconExpressions(line)) {
				for (const [, value] of expression.matchAll(STRING_LITERAL)) {
					const v = value.trim();
					if (!v || v.startsWith('lucide-')) continue;
					// An icon name is a bare kebab-case token; a class list or a
					// path has spaces or slashes.
					if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) continue;
					offenders.push(
						`${path.relative(SRC, file)}:${i + 1}  '${v}'  in: ${line.trim()}`,
					);
				}
			}
		}
	}

	assert.deepEqual(
		offenders,
		[],
		`Icon strings must be lucide- classes; these render nothing:\n${offenders.join(
			'\n',
		)}`,
	);
});
