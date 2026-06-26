import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTree } from './useTreeSearch.js';

// A small two-level tree: a group "Guides" with two pages, and a top-level page.
function sampleTree() {
	return [
		{
			doc_key: 'g1',
			title: 'Guides',
			route: 'guides',
			is_group: true,
			children: [
				{
					doc_key: 'p1',
					title: 'Getting Started',
					route: 'guides/getting-started',
					children: [],
				},
				{
					doc_key: 'p2',
					title: 'Authentication',
					route: 'guides/auth-tokens',
					children: [],
				},
			],
		},
		{ doc_key: 'p3', title: 'Changelog', route: 'changelog', children: [] },
	];
}

test('blank query returns null (not searching)', () => {
	assert.equal(filterTree(sampleTree(), ''), null);
	assert.equal(filterTree(sampleTree(), '   '), null);
});

test('matching a page keeps it and its ancestor group', () => {
	const { keep, expand, children } = filterTree(sampleTree(), 'getting');

	assert.ok(keep.has('p1'), 'matched page kept');
	assert.ok(keep.has('g1'), 'ancestor group kept');
	assert.ok(expand.has('g1'), 'ancestor group force-expanded');
	assert.ok(!keep.has('p2'), 'non-matching sibling pruned');
	assert.ok(!keep.has('p3'), 'unrelated top-level page pruned');

	// Pruned tree preserves structure: Guides group with only the match inside.
	assert.equal(children.length, 1);
	assert.equal(children[0].doc_key, 'g1');
	assert.equal(children[0].children.length, 1);
	assert.equal(children[0].children[0].doc_key, 'p1');
});

test('matches the route even when the title does not', () => {
	// "auth-tokens" lives only in p2's route, not its title ("Authentication").
	const { keep, score } = filterTree(sampleTree(), 'auth-tokens');

	assert.ok(keep.has('p2'), 'route-only hit surfaces the page');
	const result = score.get('p2');
	// A non-matching key highlights to an empty string; the matching one wraps
	// the hit in <mark>.
	assert.equal(
		result[0].highlight('<mark>', '</mark>'),
		'',
		'title key did not match',
	);
	assert.match(
		result[1].highlight('<mark>', '</mark>'),
		/<mark>auth-tokens<\/mark>/,
	);
});

test('fuzzy (non-contiguous) query still matches', () => {
	// "athn" is a subsequence of "Authentication".
	const { keep } = filterTree(sampleTree(), 'athn');
	assert.ok(keep.has('p2'));
});

test('no matches yields an empty keep set', () => {
	const { keep, children } = filterTree(sampleTree(), 'zzzznomatch');
	assert.equal(keep.size, 0);
	assert.equal(children.length, 0);
});

test('matching a group title keeps the group itself', () => {
	const { keep } = filterTree(sampleTree(), 'Guides');
	assert.ok(keep.has('g1'));
});
