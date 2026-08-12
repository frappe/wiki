import assert from 'node:assert/strict';
import test from 'node:test';

import { Node } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';

import {
	calloutMarkdownTokenizer,
	parseCalloutMarkdown,
	renderCalloutMarkdown,
} from './callout-markdown.js';
import { PreserveBlankLines } from './preserve-blank-lines.js';
import { wikiStarterKit } from './wiki-starterkit.js';

/**
 * Regression coverage for the callout markdown round-trip.
 *
 * `renderMarkdown` used to append its own `\n\n` after the closing fence. The
 * serializer already separates blocks, and the doc's trailing empty paragraph
 * serialises to another blank line, so a callout ended up followed by four
 * newlines. Four is one past the point where PreserveBlankLines turns marked's
 * `space` token into a real empty paragraph, and that paragraph serialised to
 * two more newlines on the next pass — `getMarkdown()` grew by two newlines
 * every round-trip and never settled, so repeated saves inflated the stored
 * content.
 *
 * The node view lives in callout-block.js, which imports a .vue file that
 * `node --test` cannot load. The markdown hooks are in callout-markdown.js for
 * exactly this reason, and the schema-only node below carries the real ones.
 */
const CalloutBlockSchemaOnly = Node.create({
	name: 'calloutBlock',
	group: 'block',
	atom: true,
	addAttributes() {
		return {
			type: { default: 'note' },
			title: { default: '' },
			content: { default: '' },
		};
	},
	renderHTML() {
		return ['aside', {}];
	},
	markdownTokenizer: calloutMarkdownTokenizer,
	parseMarkdown: parseCalloutMarkdown,
	renderMarkdown: renderCalloutMarkdown,
});

function buildManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: [...baseExtensions, PreserveBlankLines, CalloutBlockSchemaOnly],
		markedOptions: { breaks: true },
	});
}

/** Serialize -> parse -> serialize, `passes` times, collecting each output. */
function roundTrip(manager, source, passes = 3) {
	const outputs = [];
	let current = source;
	for (let i = 0; i < passes; i++) {
		current = manager.serialize(manager.parse(current));
		outputs.push(current);
	}
	return outputs;
}

const CASES = {
	'titled callout': ':::note[Test]\nhello\n:::',
	'callout with inline marks':
		':::note[Test]\nThis has **bold** and *italic* and [a link](https://example.com)\n:::',
	'untitled callout': ':::note\nhello\n:::',
	'callout followed by a paragraph': ':::note[T]\nhello\n:::\n\nafter para',
	'paragraph followed by a callout': 'before\n\n:::tip\nbody\n:::',
	'two adjacent callouts': ':::note\na\n:::\n\n:::tip\nb\n:::',
};

for (const [label, source] of Object.entries(CASES)) {
	test(`${label} round-trips to a fixed point`, () => {
		const outputs = roundTrip(buildManager(), source);
		assert.deepEqual(
			outputs,
			Array(outputs.length).fill(outputs[0]),
			`markdown kept changing across round-trips: ${JSON.stringify(outputs)}`,
		);
	});
}

test('renderMarkdown leaves the block separator to the serializer', () => {
	// The specific defect: a trailing separator baked into the node's own
	// output. Asserted directly so a re-introduction fails here by name rather
	// than as a puzzling growth in the round-trip tests above.
	const rendered = renderCalloutMarkdown({
		attrs: { type: 'note', title: 'T', content: 'body' },
	});
	assert.equal(rendered, ':::note[T]\nbody\n:::');
	assert.ok(
		!rendered.endsWith('\n'),
		'renderMarkdown must not append its own trailing newlines',
	);
});

test('a callout keeps one blank line before the block that follows it', () => {
	const manager = buildManager();
	const output = manager.serialize(
		manager.parse(':::note[T]\nhello\n:::\n\nafter para'),
	);
	assert.match(output, /:::\n\nafter para/);
});
