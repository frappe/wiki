import assert from 'node:assert/strict';
import test from 'node:test';

import { MarkdownManager } from '@tiptap/markdown';

import { wikiStarterKit } from './wiki-starterkit.js';

/**
 * Regression coverage for frappe/wiki#609:
 * "When copy pasting markdown text, wiki editor does not render it automatically."
 *
 * WikiEditor.vue's `handlePaste` routes a plain-text-only clipboard through
 * `insertContent(text, { contentType: 'markdown' })`. Under the hood that runs
 * the markdown source through the same MarkdownManager built here, so a paste of
 * `# Heading` / `**bold**` must yield real heading/bold/list nodes rather than a
 * paragraph of literal source. This pins that parse step against the editor's
 * real extension set (wikiStarterKit), no DOM required — same style as
 * link-markdown.test.js.
 */
function buildManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: baseExtensions,
		markedOptions: { breaks: true },
	});
}

/** Collect every node `type` present anywhere in a TipTap JSON doc. */
function nodeTypes(node, acc = new Set()) {
	if (!node || typeof node !== 'object') return acc;
	if (node.type) acc.add(node.type);
	for (const child of node.content ?? []) nodeTypes(child, acc);
	return acc;
}

/** Collect every mark `type` applied to any text node in the doc. */
function markTypes(node, acc = new Set()) {
	if (!node || typeof node !== 'object') return acc;
	for (const mark of node.marks ?? []) acc.add(mark.type);
	for (const child of node.content ?? []) markTypes(child, acc);
	return acc;
}

/** Concatenate every text run in the doc. */
function textContent(node, parts = []) {
	if (!node || typeof node !== 'object') return parts;
	if (typeof node.text === 'string') parts.push(node.text);
	for (const child of node.content ?? []) textContent(child, parts);
	return parts;
}

test('pasted markdown parses headings, bold, italic and lists into rich nodes (#609)', () => {
	const doc = buildManager().parse(
		'# Heading One\n\n**bold** and *italic*\n\n- item 1\n- item 2',
	);

	const nodes = nodeTypes(doc);
	const marks = markTypes(doc);

	assert.ok(nodes.has('heading'), 'expected a heading node');
	assert.ok(nodes.has('bulletList'), 'expected a bulletList node');
	assert.ok(nodes.has('listItem'), 'expected listItem nodes');
	assert.ok(marks.has('bold'), 'expected a bold mark');
	assert.ok(marks.has('italic'), 'expected an italic mark');
});

test('raw markdown markers do not survive as literal text (#609)', () => {
	const doc = buildManager().parse('# Heading One\n\n**bold** and *italic*');
	const text = textContent(doc).join('');

	// The pre-fix bug: the whole thing stayed as a literal paragraph.
	assert.ok(!text.includes('#'), `'#' leaked as literal text: ${text}`);
	assert.ok(!text.includes('**'), `'**' leaked as literal text: ${text}`);
	// The words themselves survive, unwrapped from their markers.
	assert.ok(text.includes('Heading One'));
	assert.ok(text.includes('bold'));
	assert.ok(text.includes('italic'));
});
