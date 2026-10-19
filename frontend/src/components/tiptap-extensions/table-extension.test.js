import assert from 'node:assert/strict';
import test from 'node:test';

import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { MarkdownManager } from '@tiptap/markdown';

import { PreserveBlankLines } from './preserve-blank-lines.js';
import { WikiTable } from './table-extension.js';
import { wikiStarterKit } from './wiki-starterkit.js';

function buildManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: [
			...baseExtensions,
			PreserveBlankLines,
			WikiTable,
			TableRow,
			TableCell,
			TableHeader,
		],
		markedOptions: { breaks: true },
	});
}

function blockTypes(manager, markdown) {
	return manager.parse(markdown).content.map((node) => node.type);
}

const FIRST_TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const SECOND_TABLE = '| c | d |\n| --- | --- |\n| 3 | 4 |';

for (const [label, markdown] of [
	['adjacent tables', `${FIRST_TABLE}\n\n${SECOND_TABLE}`],
	['paragraph between tables', `${FIRST_TABLE}\n\ntext\n\n${SECOND_TABLE}`],
	['table between paragraphs', `before\n\n${FIRST_TABLE}\n\nafter`],
	['table after a heading', `## Title\n\n${FIRST_TABLE}`],
]) {
	test(`${label} survive repeated round trips unchanged`, () => {
		const manager = buildManager();
		const expected = blockTypes(manager, markdown);
		let current = markdown;
		for (let trip = 0; trip < 3; trip++) {
			current = manager.serialize(manager.parse(current));
			assert.deepEqual(blockTypes(manager, current), expected);
		}
	});
}

function cellTexts(manager, markdown) {
	const [table] = manager.parse(markdown).content;
	return table.content.flatMap((row) =>
		row.content.map((cell) =>
			cell.content
				.flatMap((paragraph) => paragraph.content ?? [])
				.map((node) => node.text)
				.join(''),
		),
	);
}

// The server renderer shows `\|` inside a code span with its backslash, so the
// serialized cell must keep the code span's pipe raw.
for (const [label, markdown, expected, serializedCell] of [
	['escaped pipe', '| a |\n| --- |\n| x \\| y |', ['a', 'x | y'], 'x \\| y'],
	['pipe in inline code', '| a |\n| --- |\n| `x|y` |', ['a', 'x|y'], '`x|y`'],
	[
		'pipe beside inline code',
		'| a |\n| --- |\n| `x|y` and p \\| q |',
		['a', 'x|y and p | q'],
		'`x|y` and p \\| q',
	],
]) {
	test(`${label} in a cell survives repeated round trips`, () => {
		const manager = buildManager();
		let current = markdown;
		for (let trip = 0; trip < 3; trip++) {
			current = manager.serialize(manager.parse(current));
			assert.ok(current.includes(`| ${serializedCell} |`), current);
			assert.deepEqual(cellTexts(manager, current), expected);
		}
	});
}
