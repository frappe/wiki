import assert from 'node:assert/strict';
import test from 'node:test';

import { MarkdownManager } from '@tiptap/markdown';

import { WikiLink } from './link-extension.js';
import { WikiUnderline } from './underline-extension.js';
import { wikiStarterKit } from './wiki-starterkit.js';

function buildManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: [...baseExtensions, WikiLink, WikiUnderline],
		markedOptions: { breaks: true },
	});
}

function paragraph(...content) {
	return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function markTypes(node, acc = new Set()) {
	for (const mark of node.marks ?? []) acc.add(mark.type);
	for (const child of node.content ?? []) markTypes(child, acc);
	return acc;
}

test('underline serializes to inline <u> html, which markdown-it renders', () => {
	const doc = paragraph(
		{ type: 'text', text: 'see ' },
		{ type: 'text', text: 'this', marks: [{ type: 'underline' }] },
	);
	assert.equal(buildManager().serialize(doc), 'see <u>this</u>');
});

test('underline over a link keeps the link syntax intact', () => {
	const doc = paragraph({
		type: 'text',
		text: 'Frappe',
		marks: [
			{ type: 'link', attrs: { href: 'https://frappe.io' } },
			{ type: 'underline' },
		],
	});
	assert.equal(
		buildManager().serialize(doc),
		'[<u>Frappe</u>](https://frappe.io)',
	);
});

test('double plus in prose is not parsed as underline', () => {
	const doc = buildManager().parse('C++ and D++ are languages');
	assert.ok(!markTypes(doc).has('underline'));
});
