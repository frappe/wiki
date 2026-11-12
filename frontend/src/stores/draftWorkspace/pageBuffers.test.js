import assert from 'node:assert/strict';
import test from 'node:test';

import { createPageBuffers } from './pageBuffers.js';

test('dirtyPages returns only buffers whose local snapshot diverges', () => {
	const buffers = createPageBuffers();

	buffers.ensure('clean', { content: 'same' });
	buffers.setLocalContent('clean', 'same');

	buffers.ensure('dirty-a', { content: 'server a' });
	buffers.setLocalContent('dirty-a', 'local a');

	buffers.ensure('dirty-b', { content: 'server b' });
	buffers.setLocalContent('dirty-b', 'local b');

	const dirty = buffers.dirtyPages();
	assert.deepEqual(dirty.map((p) => p.docKey).sort(), ['dirty-a', 'dirty-b']);
	assert.equal(buffers.hasUnsavedEditorContent.value, true);
});

test('dirtyPages is empty when local content matches the baseline', () => {
	const buffers = createPageBuffers();

	buffers.ensure('a', { content: 'hello' });
	buffers.setLocalContent('a', 'hello');
	buffers.ensure('b', { content: 'world' });

	assert.deepEqual(buffers.dirtyPages(), []);
	assert.equal(buffers.hasUnsavedEditorContent.value, false);
});

test('a flushed save clears the page from dirtyPages', () => {
	const buffers = createPageBuffers();

	buffers.ensure('page', { content: 'old' });
	buffers.setLocalContent('page', 'new');
	assert.equal(buffers.dirtyPages().length, 1);

	// Mirrors doSaveContent's success path.
	const page = buffers.get('page');
	page.content = 'new';
	if (page.localContent === 'new') page.localContent = null;

	assert.deepEqual(buffers.dirtyPages(), []);
	assert.equal(buffers.hasUnsavedEditorContent.value, false);
});

// "Reload latest" keeps local edits only on top of the copy they were made
// on, or of our own save whose reply was lost. Anything else changed elsewhere.
test('isBasedOn tells a page changed elsewhere from our own lost save', () => {
	const buffers = createPageBuffers();
	const page = buffers.ensure('page', {
		content: 'Start.',
		serverContent: 'Start.',
	});
	buffers.setLocalContent('page', 'Start. Mine.');

	assert.equal(buffers.isBasedOn(page, 'Start.'), true);
	assert.equal(buffers.isBasedOn(page, 'Start. Theirs.'), false);

	page.sentContent = 'Start. Mi';
	assert.equal(buffers.isBasedOn(page, 'Start. Mi'), true);
});
