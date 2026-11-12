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

const MIGRATED_HTML_TABLE = `<table style="width: 100%;">

<tr>
<th>Pre-Setup Phase</th>
<th>Set up Phase</th>
</tr>

<tr>

<td>
<ul>
<li>Recruitment Process</li>
</ul>
</td>

<td>
<ul>
<li>Line Listing</li>
</ul>
</td>

</tr>

</table>`;

test('an HTML table with blank lines reaches the editor as one block', () => {
	const manager = buildManager();
	const blocks = manager.parse(
		`before\n\n${MIGRATED_HTML_TABLE}\n\nafter`,
	).content;
	assert.equal(blocks.length, 3);
	const tableText = blocks[1].content.map((node) => node.text).join('');
	assert.ok(tableText.startsWith('<table'), tableText);
	assert.ok(tableText.endsWith('</table>'), tableText);
});

function cell(type, content, attrs = {}) {
	return { type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content };
}

function paragraph(text) {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function bulletList(...items) {
	return {
		type: 'bulletList',
		content: items.map((text) => ({
			type: 'listItem',
			content: [paragraph(text)],
		})),
	};
}

function serializeTable(...rows) {
	const manager = buildManager();
	return manager.serialize({
		type: 'doc',
		content: [
			{
				type: 'table',
				content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
			},
		],
	});
}

test('a table with a list in a cell is written as HTML, not flattened', () => {
	const markdown = serializeTable(
		[cell('tableHeader', [paragraph('Pre-Setup Phase')])],
		[
			cell('tableCell', [
				bulletList('Recruitment Process', 'Meeting Functionaries'),
			]),
		],
	);
	assert.equal(
		markdown,
		'<table>\n<tr>\n<th><p>Pre-Setup Phase</p></th>\n</tr>\n<tr>\n' +
			'<td><ul>\n<li>Recruitment Process</li>\n<li>Meeting Functionaries</li>\n</ul></td>\n' +
			'</tr>\n</table>',
	);
});

test('a table with merged cells keeps its spans', () => {
	const markdown = serializeTable(
		[cell('tableHeader', [paragraph('Phase')], { colspan: 2 })],
		[cell('tableCell', [paragraph('a')]), cell('tableCell', [paragraph('b')])],
	);
	assert.ok(markdown.includes('<th colspan="2"><p>Phase</p></th>'), markdown);
});

test('a table of plain cells stays a pipe table', () => {
	const markdown = serializeTable(
		[cell('tableHeader', [paragraph('a')])],
		[cell('tableCell', [paragraph('1'), paragraph('2')])],
	);
	assert.ok(markdown.startsWith('| a'), markdown);
});

test('a cell that only says "-" stays text in an HTML table', () => {
	const markdown = serializeTable(
		[
			cell('tableHeader', [paragraph('Item')]),
			cell('tableHeader', [paragraph('Qty')]),
		],
		[
			cell('tableCell', [bulletList('Rice')]),
			cell('tableCell', [paragraph('-')]),
		],
	);
	assert.ok(markdown.includes('<td><p>-</p></td>'), markdown);
});
