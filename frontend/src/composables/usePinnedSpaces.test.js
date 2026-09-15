import assert from 'node:assert/strict';
import test from 'node:test';

import { orderSpaces } from './usePinnedSpaces.js';

// The list resource already returns spaces in switcher/creation order; pinning
// only ever reshuffles that.
const LIST = [
	{ name: 'alpha' },
	{ name: 'beta' },
	{ name: 'gamma' },
	{ name: 'delta' },
];

const names = (spaces) => spaces.map((s) => s.name);

test('no pins leaves the list order untouched', () => {
	assert.deepEqual(names(orderSpaces(LIST, [])), [
		'alpha',
		'beta',
		'gamma',
		'delta',
	]);
});

test('pinned spaces float to the top in pin order, not list order', () => {
	assert.deepEqual(names(orderSpaces(LIST, ['gamma', 'beta'])), [
		'gamma',
		'beta',
		'alpha',
		'delta',
	]);
});

test('unpinned spaces keep their relative order behind the pins', () => {
	assert.deepEqual(names(orderSpaces(LIST, ['delta'])), [
		'delta',
		'alpha',
		'beta',
		'gamma',
	]);
});

test('unpinning restores the list order', () => {
	const pinned = ['gamma'];
	const afterUnpin = pinned.filter((it) => it !== 'gamma');
	assert.deepEqual(names(orderSpaces(LIST, afterUnpin)), names(LIST));
});

test('a pin for a space outside the current page is ignored, not dropped', () => {
	// The list is paged and searchable, so a pinned space is regularly absent.
	assert.deepEqual(names(orderSpaces(LIST, ['epsilon', 'beta'])), [
		'beta',
		'alpha',
		'gamma',
		'delta',
	]);
});

test('the input list is not mutated', () => {
	const input = [...LIST];
	orderSpaces(input, ['delta']);
	assert.deepEqual(names(input), names(LIST));
});
