import assert from 'node:assert/strict';
import test from 'node:test';

// The translation global is installed during app boot, so a module that calls
// `__` at import time throws in any chunk that loads first — as this one now
// does, pulled in eagerly by the sidebar's mode strip.
test('importing does not call the translation global', async () => {
	assert.equal(globalThis.__, undefined, 'test needs an untranslated global');

	const { useChangeTypeDisplay } = await import('./useChangeTypeDisplay.js');

	globalThis.__ = (text) => `translated:${text}`;
	try {
		assert.equal(
			useChangeTypeDisplay().getChangeLabel('added'),
			'translated:New',
		);
	} finally {
		globalThis.__ = undefined;
	}
});

// The tree draws a dot, so the fill is the only thing that says which kind of
// change it is. A composed class name would not survive Tailwind's scan, so
// every one has to come back whole.
test('every change type has a whole dot class, unknown ones fall back', async () => {
	const { useChangeTypeDisplay } = await import('./useChangeTypeDisplay.js');
	const { getChangeDotClass } = useChangeTypeDisplay();

	assert.equal(getChangeDotClass('added'), 'bg-surface-green-5');
	assert.equal(getChangeDotClass('modified'), 'bg-surface-blue-5');
	assert.equal(getChangeDotClass('deleted'), 'bg-surface-red-5');
	assert.equal(getChangeDotClass('reordered'), 'bg-surface-amber-5');
	assert.equal(getChangeDotClass('something-else'), 'bg-surface-gray-5');
});
