import assert from 'node:assert/strict';
import test from 'node:test';

import { extractOutline } from './useDocumentOutline.js';

// A stand-in for a ProseMirror doc: `descendants` walks a flat node list and
// honours the callback's "skip my children" return value the same way.
function docOf(nodes) {
	return {
		descendants(callback) {
			let pos = 1;
			for (const node of nodes) {
				callback(node, pos);
				pos += (node.textContent?.length || 0) + 2;
			}
		},
	};
}

function heading(level, textContent) {
	return {
		type: { name: 'heading' },
		attrs: { level },
		textContent,
		isBlock: true,
	};
}

function paragraph(textContent) {
	return { type: { name: 'paragraph' }, textContent, isBlock: true };
}

test('collects h2 and h3 in document order', () => {
	const outline = extractOutline(
		docOf([
			heading(2, 'Install'),
			paragraph('Run the installer.'),
			heading(3, 'Requirements'),
			heading(2, 'Usage'),
		]),
	);

	assert.deepEqual(
		outline.map((entry) => [entry.level, entry.text]),
		[
			[2, 'Install'],
			[3, 'Requirements'],
			[2, 'Usage'],
		],
	);
});

test('ignores h1 and h4+, matching the published TOC', () => {
	const outline = extractOutline(
		docOf([
			heading(1, 'Page Title'),
			heading(2, 'Kept'),
			heading(4, 'Too deep'),
			heading(6, 'Deeper still'),
		]),
	);

	assert.deepEqual(
		outline.map((entry) => entry.text),
		['Kept'],
	);
});

test('skips a heading with no text yet', () => {
	const outline = extractOutline(
		docOf([heading(2, ''), heading(2, '   '), heading(2, 'Real')]),
	);

	assert.deepEqual(
		outline.map((entry) => entry.text),
		['Real'],
	);
});

test('trims heading text', () => {
	const [entry] = extractOutline(docOf([heading(2, '  Spaced  ')]));
	assert.equal(entry.text, 'Spaced');
});

test('reports the position of each heading', () => {
	const outline = extractOutline(
		docOf([heading(2, 'One'), paragraph('body'), heading(2, 'Two')]),
	);

	assert.deepEqual(
		outline.map((entry) => entry.pos),
		[1, 12],
	);
});

test('returns an empty outline for an empty or missing doc', () => {
	assert.deepEqual(extractOutline(docOf([])), []);
	assert.deepEqual(extractOutline(null), []);
	assert.deepEqual(extractOutline({}), []);
});
