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
