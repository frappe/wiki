import { Extension } from '@tiptap/core';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { Marked } from 'marked-tiptap';

import { WIKI_MARKED_OPTIONS } from './wiki-markdown.js';

const TABLE_TAG = /<(\/?)table\b[^>]*>/gi;

const cellMarked = new Marked(WIKI_MARKED_OPTIONS);

/**
 * Reads an HTML `<table>` as one block, blank lines included.
 *
 * Markdown ends an HTML block at the first blank line, so a hand-written
 * table with blank lines between rows (common in pages migrated from wiki v2)
 * reached the editor in pieces: an empty table followed by the cell contents
 * as loose paragraphs, which the next save wrote back flattened.
 */
export const htmlTableTokenizer = {
	name: 'htmlTable',
	level: 'block',

	start: (src) => src.search(/^ {0,3}<table[\s>]/im),

	tokenize(src) {
		if (!/^ {0,3}<table[\s>]/i.test(src)) return undefined;

		let depth = 0;
		for (const tag of src.matchAll(TABLE_TAG)) {
			depth += tag[1] ? -1 : 1;
			if (depth > 0) continue;
			const lineEnd = src.indexOf('\n', tag.index + tag[0].length);
			const raw = lineEnd === -1 ? src : src.slice(0, lineEnd + 1);
			return { type: 'html', block: true, raw, text: raw };
		}
		return undefined;
	},
};

// Its own extension: Table already uses its tokenizer slot for pipe tables.
const HtmlTable = Extension.create({
	name: 'htmlTable',
	markdownTokenizer: htmlTableTokenizer,
});

/**
 * Table with a markdown serializer that round-trips.
 *
 * - No leading newline. The stock serializer opens with `\n`, so two adjacent
 *   tables get an extra blank line between them, which parses back as an
 *   empty paragraph and grows on every round trip (#872).
 * - Pipes inside a cell are escaped. Unescaped, `a | b` splits into two
 *   cells on the next parse and the text after the pipe is lost. Code spans
 *   keep raw pipes: both parsers already read them as one cell, and the
 *   server renderer would show an escaped one with its backslash.
 * - A table that a pipe table cannot hold (a list or other block in a cell,
 *   merged cells) is written as HTML instead of being flattened.
 */
export const WikiTable = Table.extend({
	addExtensions() {
		return [HtmlTable];
	},

	renderMarkdown(node, helpers) {
		if (needsHtml(node)) return renderTableToHtml(node, helpers);

		const cellHelpers = Object.create(helpers);
		cellHelpers.renderChildren = (content) =>
			helpers
				.renderChildren(content)
				.replace(/(`+)[\s\S]*?\1|(?<!\\)\|/g, (match, ticks) =>
					ticks ? match : '\\|',
				);
		return renderTableToMarkdown(node, cellHelpers).replace(/^\n/, '');
	},
});

function needsHtml(table) {
	return (table.content ?? []).some((row) =>
		(row.content ?? []).some(
			(cell) =>
				cell.attrs?.colspan > 1 ||
				cell.attrs?.rowspan > 1 ||
				(cell.content ?? []).some((child) => child.type !== 'paragraph'),
		),
	);
}

function renderTableToHtml(table, helpers) {
	const rows = (table.content ?? []).map((row) => {
		const cells = (row.content ?? []).map((cell) => {
			const tag = cell.type === 'tableHeader' ? 'th' : 'td';
			const span = ['colspan', 'rowspan']
				.filter((name) => cell.attrs?.[name] > 1)
				.map((name) => ` ${name}="${cell.attrs[name]}"`)
				.join('');
			const blocks = (cell.content ?? []).map((child) =>
				renderBlockToHtml(child, helpers),
			);
			return `<${tag}${span}>${blocks.join('\n')}</${tag}>`;
		});
		return `<tr>\n${cells.join('\n')}\n</tr>`;
	});
	return `<table>\n${rows.join('\n')}\n</table>`;
}

// Paragraphs are parsed inline: a cell that only says `-` would otherwise
// come back as an empty list.
function renderBlockToHtml(block, helpers) {
	const markdown = helpers.renderChildren([block]);
	if (block.type === 'paragraph') {
		return `<p>${cellMarked.parseInline(markdown).trim()}</p>`;
	}
	return cellMarked.parse(markdown).trim();
}
