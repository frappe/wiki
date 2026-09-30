import assert from 'node:assert/strict';
import test from 'node:test';

import { Node, getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { Slice } from '@tiptap/pm/model';

import { renderImageMarkdown } from './image-markdown.js';
import {
	dataUrlToFile,
	isDataImageSrc,
	tagDataImagesInJSON,
	tagDataImagesInSlice,
} from './paste-data-images.js';
import { wikiStarterKit } from './wiki-starterkit.js';

/**
 * Regression coverage for base64 images pasted as HTML.
 *
 * HTML from Google Docs, Notion or a web page can carry `<img src="data:…">`
 * with no file on the clipboard. ProseMirror inserted it as-is, the base64
 * was saved into the page markdown, and one production page grew to 3 MB for
 * a 6 KB document. Every later parse of that page took over 200 ms, so typing
 * lagged by seconds.
 *
 * The image node view lives in image-extension.js, which imports a .vue file
 * that `node --test` cannot load. This schema-only node carries the real
 * markdown serializer.
 */
const ImageSchemaOnly = Node.create({
	name: 'image',
	group: 'block',
	addAttributes() {
		return {
			src: { default: null },
			alt: { default: null },
			title: { default: null },
			caption: { default: null },
			loading: { default: false },
			uploadId: { default: null },
			error: { default: null },
		};
	},
	renderHTML({ HTMLAttributes }) {
		return ['img', HTMLAttributes];
	},
	renderMarkdown: renderImageMarkdown,
});

function buildExtensions() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return [
		...baseExtensions.filter((extension) => extension.name !== 'image'),
		ImageSchemaOnly,
	];
}

const DATA_SRC = `data:image/png;base64,${'iVBORw0KGgo'.repeat(1000)}`;
const FILE_SRC = '/files/photo.webp';

function pastedDoc() {
	return {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
			{ type: 'image', attrs: { src: DATA_SRC } },
			{ type: 'image', attrs: { src: FILE_SRC } },
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{ type: 'image', attrs: { src: DATA_SRC } }],
					},
				],
			},
		],
	};
}

function images(json, acc = []) {
	if (json?.type === 'image') acc.push(json.attrs);
	for (const child of json?.content ?? []) images(child, acc);
	return acc;
}

test('isDataImageSrc only matches data image URIs', () => {
	assert.equal(isDataImageSrc(DATA_SRC), true);
	assert.equal(isDataImageSrc('DATA:image/jpeg;base64,abc'), true);
	assert.equal(isDataImageSrc(FILE_SRC), false);
	assert.equal(isDataImageSrc('data:text/html,<p>x</p>'), false);
	assert.equal(isDataImageSrc(null), false);
});

test('a pasted slice keeps its base64 images out of the markdown', () => {
	const extensions = buildExtensions();
	const schema = getSchema(extensions);
	const manager = new MarkdownManager({ extensions });
	const doc = schema.nodeFromJSON(pastedDoc());
	const pasted = new Slice(doc.content, 0, 0);

	const { slice, uploads } = tagDataImagesInSlice(pasted);

	assert.equal(uploads.length, 2);
	assert.ok(uploads.every((upload) => upload.src === DATA_SRC));
	const tagged = schema.node('doc', null, slice.content).toJSON();
	const markdown = manager.serialize(tagged);
	assert.ok(!markdown.includes('data:image'), markdown);
	assert.ok(markdown.includes(FILE_SRC));
	assert.ok(markdown.includes('Before'));

	const [first, file, nested] = images(tagged);
	assert.equal(first.loading, true);
	assert.equal(nested.loading, true);
	assert.equal(file.loading, false);
	assert.deepEqual(
		uploads.map((upload) => upload.uploadId),
		[first.uploadId, nested.uploadId],
	);
});

test('a slice without base64 images comes back unchanged', () => {
	const schema = getSchema(buildExtensions());
	const doc = schema.nodeFromJSON({
		type: 'doc',
		content: [{ type: 'image', attrs: { src: FILE_SRC } }],
	});
	const pasted = new Slice(doc.content, 0, 0);

	const { slice, uploads } = tagDataImagesInSlice(pasted);

	assert.equal(slice, pasted);
	assert.equal(uploads.length, 0);
});

test('pasted markdown JSON tags base64 images the same way', () => {
	const { json, uploads } = tagDataImagesInJSON(pastedDoc());

	assert.equal(uploads.length, 2);
	const [first, file, nested] = images(json);
	assert.equal(first.loading, true);
	assert.equal(nested.loading, true);
	assert.equal(file.loading, undefined);
	assert.equal(first.uploadId, uploads[0].uploadId);
});

test('an image whose upload failed is not serialized', () => {
	const extensions = buildExtensions();
	const manager = new MarkdownManager({ extensions });

	const markdown = manager.serialize({
		type: 'doc',
		content: [
			{
				type: 'image',
				attrs: { src: DATA_SRC, loading: false, error: 'Upload failed' },
			},
		],
	});

	assert.ok(!markdown.includes('data:image'), markdown);
});

// Two images pasted together were both uploaded as `pasted-image.png`, and
// the page ended up showing the same image twice.
test('each pasted image gets its own file name', async (t) => {
	const draws = [0.25, 0.75];
	t.mock.method(Math, 'random', () => draws.shift());

	const first = await dataUrlToFile('data:image/png;base64,iVBORw0KGgo=');
	const second = await dataUrlToFile('data:image/png;base64,iVBORw0KGgo=');

	assert.equal(
		first.name,
		`pasted-image-${(0.25).toString(36).slice(2, 10)}.png`,
	);
	assert.equal(
		second.name,
		`pasted-image-${(0.75).toString(36).slice(2, 10)}.png`,
	);
	assert.notEqual(first.name, second.name);
	assert.equal(first.type, 'image/png');
});
