/**
 * Markdown parse/serialize for the callout block.
 *
 * Split out of callout-block.js so it can be unit tested: that module imports a
 * .vue node view at the top level, which `node --test` cannot load.
 *
 * The callout is a container node (`content: 'block+'`), so the fence body is
 * tokenized and parsed into real child nodes rather than kept as a string. This
 * mirrors TipTap's own `createBlockMarkdownSpec`, which we can't use directly:
 * it emits Pandoc's `:::name {attrs}` syntax, and the wiki's stored format is
 * Starlight's `:::type[Title]`.
 */

/**
 * Callout types that are supported
 */
export const CALLOUT_TYPES = ['note', 'tip', 'caution', 'danger', 'warning'];

/**
 * Tokenize the fence body as block markdown.
 *
 * `blockTokens` leaves inline tokens unresolved on tokens it built from a plain
 * text run, so they're filled in here — without them the parser sees no bold,
 * italic or link inside a callout. Trailing empty paragraphs come from the
 * blank line the author left before the closing fence and would otherwise
 * become a real empty block on every round-trip.
 */
function tokenizeCalloutBody(body, lexer) {
	if (!body || !lexer) return [];

	const tokens = lexer.blockTokens(body);

	for (const token of tokens) {
		if (token.text && (!token.tokens || token.tokens.length === 0)) {
			token.tokens = lexer.inlineTokens(token.text);
		}
	}

	while (tokens.length > 0) {
		const last = tokens[tokens.length - 1];
		if (last.type === 'paragraph' && !last.text?.trim()) {
			tokens.pop();
		} else {
			break;
		}
	}

	return tokens;
}

export const calloutMarkdownTokenizer = {
	name: 'calloutBlock',
	level: 'block',

	start(src) {
		return src.indexOf(':::');
	},

	tokenize(src, _tokens, lexer) {
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
		const body = (match[3] || '').trim();

		return {
			type: 'calloutBlock',
			raw: match[0],
			calloutType: calloutType,
			title: match[2] || '',
			text: body,
			tokens: tokenizeCalloutBody(body, lexer),
		};
	},
};

export function parseCalloutMarkdown(token, h) {
	const content = h.parseChildren(token.tokens || []);

	return {
		type: 'calloutBlock',
		attrs: {
			type: token.calloutType || 'note',
			title: token.title || '',
		},
		// `block+` needs at least one child, and an empty callout is a legal
		// thing to write.
		content: content.length ? content : [{ type: 'paragraph' }],
	};
}

// No trailing block separator: the serializer already puts one between blocks,
// and the doc's trailing empty paragraph contributes another. Adding a third
// pushed the run past three newlines, which is where PreserveBlankLines starts
// turning a `space` token into real empty paragraphs — so every round-trip grew
// the document by two newlines and getMarkdown() never settled. Heading and list
// are stable for the same reason: they leave the separator to the serializer.
export function renderCalloutMarkdown(node, h) {
	const calloutType = node.attrs?.type || 'note';
	const title = node.attrs?.title || '';
	const body = h.renderChildren(node.content || [], '\n\n').trim();
	const fence = title ? `:::${calloutType}[${title}]` : `:::${calloutType}`;

	return `${fence}\n${body}\n:::`;
}
