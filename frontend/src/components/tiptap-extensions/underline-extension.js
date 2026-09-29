import Underline from '@tiptap/extension-underline';

/**
 * Underline stored as inline `<u>…</u>` HTML instead of the stock `++…++`.
 * Wiki markdown is rendered by markdown-it, which has no `++` syntax but
 * passes inline HTML through, and the editor parses `<u>` back via parseHTML.
 * The stock `++` tokenizer is dropped too: it would turn text like
 * `C++ and D++` into underline.
 */
export const WikiUnderline = Underline.extend({
	parseHTML() {
		return [
			{ tag: 'u' },
			{
				// Copied hyperlinks arrive as `<a style="text-decoration: underline">`,
				// so only spans (Google Docs, Word) carry underline from inline style.
				// Otherwise every pasted link picks up an underline mark (#667).
				tag: 'span',
				consuming: false,
				getAttrs: (element) =>
					element.style.textDecoration.includes('underline') ? null : false,
			},
		];
	},

	markdownTokenizer: null,

	renderMarkdown(node, helpers) {
		return `<u>${helpers.renderChildren(node)}</u>`;
	},
});
