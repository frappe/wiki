import assert from 'node:assert/strict';
import test from 'node:test';

import { Node } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';

import {
	calloutMarkdownTokenizer,
	parseCalloutMarkdown,
	renderCalloutMarkdown,
} from './callout-markdown.js';
import { wikiMarkdown } from './wiki-markdown.js';
import { wikiStarterKit } from './wiki-starterkit.js';

/**
 * Regression coverage for tokenizers piling up on the global `marked`.
 *
 * Each WikiEditor mount builds a MarkdownManager. Without its own `marked`
 * instance, the manager registered the custom tokenizers on the global
 * singleton, so every page opened in the SPA added another full set. In a
 * long session a 3 MB page parse went from ~20 ms to over 200 ms, and the
 * editor parses on every keystroke.
 */
const CalloutBlockSchemaOnly = Node.create({
	name: 'calloutBlock',
	group: 'block',
	content: 'block+',
	addAttributes() {
		return { type: { default: 'note' }, title: { default: '' } };
	},
	renderHTML() {
		return ['aside', {}, 0];
	},
	markdownTokenizer: calloutMarkdownTokenizer,
	parseMarkdown: parseCalloutMarkdown,
	renderMarkdown: renderCalloutMarkdown,
});

// Mirrors how the Markdown extension builds its manager in onBeforeCreate.
function buildManager() {
	const markdown = wikiMarkdown();
	const starterKit = wikiStarterKit();
	return new MarkdownManager({
		marked: markdown.options.marked,
		markedOptions: markdown.options.markedOptions,
		extensions: [
			...starterKit.config.addExtensions.call({
				options: starterKit.options,
				name: 'starterKit',
			}),
			CalloutBlockSchemaOnly,
		],
	});
}

function blockTokenizerCount(manager) {
	return manager.instance.defaults.extensions?.block?.length ?? 0;
}

test('each editor gets a marked instance of its own', () => {
	assert.notEqual(wikiMarkdown().options.marked, wikiMarkdown().options.marked);
});

test('mounting more editors does not add tokenizers to earlier ones', () => {
	const first = buildManager();
	const registered = blockTokenizerCount(first);
	assert.ok(registered > 0, 'the callout tokenizer should be registered');

	const later = Array.from({ length: 5 }, buildManager);

	assert.equal(blockTokenizerCount(first), registered);
	for (const manager of later) {
		assert.equal(blockTokenizerCount(manager), registered);
	}
});

test('an isolated instance still parses wiki markdown', () => {
	const doc = buildManager().parse(':::note[Heads up]\nBody\n:::');
	assert.equal(doc.content[0].type, 'calloutBlock');
	assert.equal(doc.content[0].attrs.title, 'Heads up');
});
