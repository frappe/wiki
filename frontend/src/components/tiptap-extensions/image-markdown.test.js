import assert from 'node:assert/strict';
import test from 'node:test';

import { Node } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';

import {
	imageCaptionTokenizer,
	renderImageMarkdown,
} from './image-markdown.js';
import { wikiStarterKit } from './wiki-starterkit.js';

// image-extension.js imports a .vue node view that `node --test` cannot load,
// so this node carries the real tokenizer and serializer on a bare schema.
const ImageSchemaOnly = Node.create({
	name: 'image',
	group: 'block',
	addAttributes() {
		return {
			src: { default: null },
			darkSrc: { default: null },
			alt: { default: null },
			title: { default: null },
			caption: { default: null },
		};
	},
	renderHTML({ HTMLAttributes }) {
		return ['img', HTMLAttributes];
	},
	markdownTokenizer: imageCaptionTokenizer,
	markdownTokenName: 'wikiImage',
	parseMarkdown: (token, helpers) =>
		helpers.createNode('image', {
			src: token.href,
			darkSrc: token.darkSrc || null,
			title: token.title,
			alt: token.text,
			caption: token.caption || null,
		}),
	renderMarkdown: renderImageMarkdown,
});

function createManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: [
			...baseExtensions.filter((extension) => extension.name !== 'image'),
			ImageSchemaOnly,
		],
	});
}

function imageAttrs(manager, markdown) {
	return manager.parse(markdown).content.find((node) => node.type === 'image')
		?.attrs;
}

const PICTURE = [
	'<picture>',
	'  <source srcset="/files/shot-dark.png" media="(prefers-color-scheme: dark)">',
	'  <img src="/files/shot.png" alt="Settings page">',
	'</picture>',
	'*The settings page*',
].join('\n');

test('parses a <picture> block into one image with a dark version', () => {
	const attrs = imageAttrs(createManager(), PICTURE);

	assert.equal(attrs.src, '/files/shot.png');
	assert.equal(attrs.darkSrc, '/files/shot-dark.png');
	assert.equal(attrs.alt, 'Settings page');
	assert.equal(attrs.caption, 'The settings page');
});

test('a <picture> block round-trips byte for byte', () => {
	const manager = createManager();

	assert.equal(manager.serialize(manager.parse(PICTURE)).trim(), PICTURE);
});

test('an image without a dark version still saves as ![alt](src)', () => {
	const manager = createManager();
	const markdown = '![Settings](/files/shot.png "Title")\n*Caption*';

	assert.equal(manager.serialize(manager.parse(markdown)).trim(), markdown);
	assert.equal(imageAttrs(manager, markdown).darkSrc, null);
});

test('adding a dark version switches the image to <picture>', () => {
	const markdown = renderImageMarkdown({
		attrs: {
			src: '/files/shot.png',
			darkSrc: '/files/shot-dark.png',
			alt: 'Settings page',
			caption: 'The settings page',
		},
	});

	assert.equal(markdown, PICTURE);
});

test('attribute values survive quotes, spaces and commas', () => {
	const manager = createManager();
	const original = {
		src: '/files/a "b" & <c>.png',
		darkSrc: '/files/CleanShot 1, dark.png',
		alt: 'Say "hi" & <wave>',
		title: 'A "title"',
		caption: null,
	};
	const markdown = renderImageMarkdown({ attrs: original });
	const attrs = imageAttrs(manager, markdown);

	assert.ok(markdown.includes('srcset="/files/CleanShot%201%2C%20dark.png"'));
	assert.equal(attrs.src, original.src);
	assert.equal(attrs.darkSrc, '/files/CleanShot%201%2C%20dark.png');
	assert.equal(attrs.alt, original.alt);
	assert.equal(attrs.title, original.title);
	assert.equal(manager.serialize(manager.parse(markdown)).trim(), markdown);
});

test('a <picture> without a dark source is not read as an image', () => {
	const manager = createManager();
	const markdown = [
		'<picture>',
		'  <source srcset="/files/wide.png" media="(min-width: 800px)">',
		'  <img src="/files/narrow.png" alt="">',
		'</picture>',
	].join('\n');

	assert.equal(imageAttrs(manager, markdown), undefined);
});
