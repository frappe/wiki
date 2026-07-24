import { Extension } from '@tiptap/core';

// Preserve consecutive blank lines in markdown round-trips.
// Parse: marked's 'space' tokens (ignored by default) become empty paragraphs.
export const PreserveBlankLines = Extension.create({
	name: 'preserveBlankLines',
	markdownTokenName: 'space',
	parseMarkdown(token) {
		const count = Math.floor(token.raw.length / 2) - 1;
		if (count <= 0) return null;
		return Array.from({ length: count }, () => ({ type: 'paragraph' }));
	},
});
