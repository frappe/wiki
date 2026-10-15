import { Table, renderTableToMarkdown } from '@tiptap/extension-table';

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
 */
export const WikiTable = Table.extend({
	renderMarkdown(node, helpers) {
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
