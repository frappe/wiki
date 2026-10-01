import assert from 'node:assert/strict';
import test from 'node:test';

import {
	daysIn,
	drillDownRange,
	hasDelta,
	intervalFor,
	presetRange,
} from './analyticsRange.js';

test('a preset range ends today and counts today as one of its days', () => {
	const range = presetRange(30, new Date(2026, 2, 31));
	assert.deepEqual(range, ['2026-03-02', '2026-03-31']);
	assert.equal(daysIn(range), 30);
});

test('a preset range crosses month and year ends', () => {
	assert.deepEqual(presetRange(7, new Date(2026, 0, 3)), [
		'2025-12-28',
		'2026-01-03',
	]);
});

test('interval grows with the range', () => {
	assert.equal(intervalFor(presetRange(90)), 'daily');
	assert.equal(intervalFor(presetRange(91)), 'weekly');
	assert.equal(intervalFor(presetRange(180)), 'weekly');
	assert.equal(intervalFor(presetRange(181)), 'monthly');
});

test('drilling into a week or month keeps inside the charted range', () => {
	const range = ['2026-01-07', '2026-03-20'];
	// The first weekly bucket starts on the Monday before the range does.
	assert.deepEqual(drillDownRange('2026-01-05', 'weekly', range), [
		'2026-01-07',
		'2026-01-11',
	]);
	assert.deepEqual(drillDownRange('2026-02-02', 'weekly', range), [
		'2026-02-02',
		'2026-02-08',
	]);
	assert.deepEqual(drillDownRange('2026-02-01', 'monthly', range), [
		'2026-02-01',
		'2026-02-28',
	]);
	assert.deepEqual(drillDownRange('2026-03-01', 'monthly', range), [
		'2026-03-01',
		'2026-03-20',
	]);
});

test('a day has nothing to drill into', () => {
	assert.equal(
		drillDownRange('2026-02-02', 'daily', ['2026-02-01', '2026-02-10']),
		null,
	);
});

test('hasDelta is false when no row carries a delta', () => {
	assert.equal(hasDelta([{ delta: null }, { delta: undefined }, {}]), false);
	assert.equal(hasDelta([]), false);
	assert.equal(hasDelta(undefined), false);
});

test('hasDelta is true when any row carries a delta, including zero', () => {
	assert.equal(hasDelta([{ delta: null }, { delta: 0 }]), true);
	assert.equal(hasDelta([{ delta: -12.5 }]), true);
});
