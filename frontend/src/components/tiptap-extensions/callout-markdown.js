/**
 * Markdown parse/serialize for the callout block.
 *
 * Split out of callout-block.js so it can be unit tested: that module imports a
 * .vue node view at the top level, which `node --test` cannot load.
 */

/**
 * Callout types that are supported
 */
export const CALLOUT_TYPES = ['note', 'tip', 'caution', 'danger', 'warning'];

export const calloutMarkdownTokenizer = {
	name: 'calloutBlock',
	level: 'block',

	start(src) {
		return src.indexOf(':::');
	},

	tokenize(src) {
		// Match :::type[title]\ncontent\n::: or :::type\ncontent\n:::
		const match =
			/^:::(\w+)(?:\[([^\]]*)\])?\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);

		if (!match) {
			return undefined;
		}

		const rawType = match[1].toLowerCase();
		if (!CALLOUT_TYPES.includes(rawType)) {
			return undefined;
		}

		// Normalize 'warning' to 'caution'
		const calloutType = rawType === 'warning' ? 'caution' : rawType;

		return {
			type: 'calloutBlock',
			raw: match[0],
			calloutType: calloutType,
			title: match[2] || '',
			text: (match[3] || '').trim(),
		};
	},
};

export function parseCalloutMarkdown(token) {
	return {
		type: 'calloutBlock',
		attrs: {
			type: token.calloutType || 'note',
			title: token.title || '',
			content: token.text || '',
		},
	};
}

// No trailing block separator: the serializer already puts one between blocks,
// and the doc's trailing empty paragraph contributes another. Adding a third
// pushed the run past three newlines, which is where PreserveBlankLines starts
// turning a `space` token into real empty paragraphs — so every round-trip grew
// the document by two newlines and getMarkdown() never settled. Heading and list
// are stable for the same reason: they leave the separator to the serializer.
export function renderCalloutMarkdown(node) {
	const calloutType = node.attrs.type || 'note';
	const title = node.attrs.title || '';
	const content = node.attrs.content || '';

	if (title) {
		return `:::${calloutType}[${title}]\n${content}\n:::`;
	}
	return `:::${calloutType}\n${content}\n:::`;
}
