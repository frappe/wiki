import assert from 'node:assert/strict';
import test from 'node:test';

import { Node } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
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
 *
 * The callout is a container node, so the cases also cover the block children
 * that only became reachable once the body stopped being a string attribute:
 * lists, headings, code blocks and multiple paragraphs.
 */
const CalloutBlockSchemaOnly = Node.create({
	name: 'calloutBlock',
	group: 'block',
	content: 'block+',
	defining: true,
	isolating: true,
	addAttributes() {
		return {
			type: { default: 'note' },
			title: { default: '' },
		};
	},
	renderHTML() {
		return ['aside', {}, ['div', { class: 'callout-content' }, 0]];
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
	// wikiStarterKit turns codeBlock off because WikiEditor swaps in frappe-ui's
	// CodeBlock, whose .vue node view `node --test` can't load. The plain node
	// carries the same name and markdown spec, so it stands in here — without it
	// a fenced block inside a callout silently degrades to a bare text node and
	// the round-trip still looks stable.
	return new MarkdownManager({
		extensions: [
			...baseExtensions,
			CodeBlock,
			PreserveBlankLines,
			CalloutBlockSchemaOnly,
		],
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
	'callout with two paragraphs': ':::note\nfirst para\n\nsecond para\n:::',
	'callout with a bullet list': ':::tip\nlead in\n\n- one\n- two\n:::',
	'callout with a heading': ':::note\n## Heading\n\nbody\n:::',
	'callout with a code block': ':::caution\n```js\nconst a = 1;\n```\n:::',
	'callout with an ordered list and marks':
		':::danger[Careful]\n1. **first**\n2. *second*\n:::',
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

test('a callout body parses into real block nodes', () => {
	// A fixed point on its own proves nothing about fidelity: content that
	// degrades to plain text round-trips just as stably. Assert the shape.
	const manager = buildManager();
	const callout = manager.parse(
		':::tip[How]\nlead **in**\n\n- one\n\n```js\nconst a = 1;\n```\n:::',
	).content[0];

	assert.equal(callout.type, 'calloutBlock');
	assert.deepEqual(callout.attrs, { type: 'tip', title: 'How' });
	assert.deepEqual(
		callout.content.map((child) => child.type),
		['paragraph', 'bulletList', 'codeBlock'],
	);
	assert.deepEqual(callout.content[0].content[1].marks, [{ type: 'bold' }]);
	assert.equal(callout.content[2].attrs.language, 'js');
});

test('an empty callout still parses to a body that block+ accepts', () => {
	const callout = buildManager().parse(':::note\n\n:::').content[0];
	assert.deepEqual(callout.content, [{ type: 'paragraph' }]);
});

test('renderMarkdown leaves the block separator to the serializer', () => {
	// The specific defect: a trailing separator baked into the node's own
	// output. Asserted directly so a re-introduction fails here by name rather
	// than as a puzzling growth in the round-trip tests above.
	const rendered = renderCalloutMarkdown(
		{
			attrs: { type: 'note', title: 'T' },
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
			],
		},
		{ renderChildren: () => 'body' },
	);
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
