import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNode } from './treeModel.js';
import { restoredDraftBuffer, toPublished } from './utils.js';

test('toPublished treats server checkbox ints correctly', () => {
	// Frappe sends 0/1 over JSON — 0 must read as unpublished (the old
	// `!== false` check read it as published, so unpublish vanished on
	// refresh).
	assert.equal(toPublished(0), false);
	assert.equal(toPublished(1), true);
	assert.equal(toPublished(false), false);
	assert.equal(toPublished(true), true);
	// Missing flag defaults to published (legacy / git-synced nodes).
	assert.equal(toPublished(undefined), true);
	assert.equal(toPublished(null), true);
});

test('normalizeNode reads is_published: 0 as unpublished', () => {
	const node = normalizeNode({
		doc_key: 'k1',
		title: 'Introduction',
		is_published: 0,
		children: [{ doc_key: 'k2', title: 'Child', is_published: 1 }],
	});

	assert.equal(node.isPublished, false);
	assert.equal(node.children[0].isPublished, true);
});

test('restored draft buffer takes publish state from the tree node', () => {
	const buffer = restoredDraftBuffer({
		docKey: 'page-1',
		title: 'Introduction',
		content: 'server content',
		localContent: 'unsaved local content',
		node: { route: 'space/introduction', isPublished: false },
	});

	assert.equal(buffer.isPublished, false);
	assert.equal(buffer.route, 'space/introduction');
	assert.equal(buffer.content, 'server content');
	assert.equal(buffer.localContent, 'unsaved local content');
});

test('restored draft buffer keeps published pages published', () => {
	const buffer = restoredDraftBuffer({
		docKey: 'page-2',
		title: 'Guide',
		content: 'x',
		localContent: 'y',
		node: { route: 'space/guide', isPublished: true },
	});

	assert.equal(buffer.isPublished, true);
});
