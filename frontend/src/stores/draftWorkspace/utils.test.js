import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isRetryableError, makeDocKey, toPublished } from './utils.js';

test('makeDocKey gives a key the server patterns accept', () => {
	assert.match(makeDocKey(), /^[0-9a-f]{32}$/);
	assert.notEqual(makeDocKey(), makeDocKey());
});

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

test('isRetryableError retries what may yet land and drops what the server refused', () => {
	assert.equal(isRetryableError(new TypeError('Failed to fetch')), true);
	assert.equal(isRetryableError({ exc_type: 'TimestampMismatchError' }), true);
	assert.equal(isRetryableError({ exc_type: 'ValidationError' }), false);
	assert.equal(isRetryableError({ exc_type: 'PermissionError' }), false);
	assert.equal(isRetryableError({ exc_type: 'PermissionError' }, true), true);
});
