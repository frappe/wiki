import assert from 'node:assert/strict';
import { test } from 'vitest';

import { MarkdownManager } from '@tiptap/markdown';
import { StarterKit } from '@tiptap/starter-kit';

import { WikiLink } from './link-extension.js';
import { wikiStarterKit } from './wiki-starterkit.js';

// A paragraph holding one link whose text also carries an underline mark — the
// exact shape ProseMirror produces when you paste a hyperlink copied from another
// source, since copied links arrive with `text-decoration: underline`.
const LINKED_UNDERLINED_TEXT = {
	type: 'doc',
	content: [
		{
			type: 'paragraph',
			content: [
				{
					type: 'text',
					text: 'Frappe',
					marks: [
						{ type: 'link', attrs: { href: 'https://frappe.io' } },
						{ type: 'underline' },
					],
				},
			],
		},
	],
};

// Builds a markdown serializer from a StarterKit instance plus WikiLink — the
// same extension set the editors feed TipTap — so this exercises the real
// round-trip the editor performs on save, no DOM required.
function serialize(starterKit) {
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	const manager = new MarkdownManager({
		extensions: [...baseExtensions, WikiLink],
		markedOptions: { breaks: true },
	});
	return manager.serialize(LINKED_UNDERLINED_TEXT);
}

// Pins the root cause: StarterKit's default Underline mark serializes to `++…++`,
// which leaks onto pasted links. Documents *why* the shared wikiStarterKit
// disables underline. The exact nesting (`++[text](url)++` vs `[++text++](url)`)
// has shifted across @tiptap/markdown releases, so only the corruption marker
// is asserted. See issue #667.
test('default StarterKit corrupts a pasted underlined link with ++', () => {
	assert.match(serialize(StarterKit.configure({ link: false })), /\+\+/);
});

// Regression: WikiEditor.vue builds its StarterKit via wikiStarterKit(), which
// disables underline. The pasted link must serialize cleanly through that exact config.
test('wikiStarterKit serializes a pasted underlined link without ++', () => {
	assert.equal(serialize(wikiStarterKit()), '[Frappe](https://frappe.io)');
});

function parsedLinks(markdown) {
	const starterKit = wikiStarterKit();
	const manager = new MarkdownManager({
		extensions: [
			...starterKit.config.addExtensions.call({
				options: starterKit.options,
				name: 'starterKit',
			}),
			WikiLink,
		],
	});
	const links = [];
	const walk = (node) => {
		for (const mark of node.marks ?? []) {
			if (mark.type === 'link') links.push(mark.attrs.href);
		}
		for (const child of node.content ?? []) walk(child);
	};
	walk(manager.parse(markdown));
	return links;
}

test.each([
	'javascript:alert(1)',
	'JaVaScRiPt:alert(1)',
	'javascript://%0aalert(1)',
	'data:text/html,x',
	'vbscript:x',
])('opens a stored %s link as plain text', (href) => {
	assert.deepEqual(parsedLinks(`[text](${href})`), []);
});

test.each([
	'https://example.com',
	'mailto:team@example.com',
	'tel:+41791112233',
	'/docs/setup',
	'wiki:abc123',
	'slack://channel',
])('keeps the stored %s link', (href) => {
	assert.deepEqual(parsedLinks(`[text](${href})`), [href]);
});

test.each([
	['javascript:alert(1)', false],
	['java\tscript:alert(1)', false],
	['data:text/html,x', false],
	['https://example.com', null],
])('pasted html with the href %j parses to %j', (href, attrs) => {
	const [rule] = WikiLink.config.parseHTML.call({});
	assert.equal(rule.getAttrs({ getAttribute: () => href }), attrs);
});
