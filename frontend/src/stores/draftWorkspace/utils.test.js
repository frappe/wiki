import assert from 'node:assert/strict';
import test from 'node:test';

import { restoredDraftBuffer } from './utils.js';

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
