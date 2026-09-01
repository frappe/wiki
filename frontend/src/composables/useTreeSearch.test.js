import assert from 'node:assert/strict';
import test from 'node:test';

import fuzzysort from 'fuzzysort';
import { filterTree, highlightSegments } from './useTreeSearch.js';

const has = (matches, key) => matches.some((node) => node.doc_key === key);

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

// The result list is flat: a nested match is its own row, and the ancestors
// that used to be dragged along with it are not results.
test('a nested match is one flat row, without its ancestor group', () => {
	const { matches } = filterTree(sampleTree(), 'getting');

	assert.deepEqual(
		matches.map((node) => node.doc_key),
		['p1'],
	);
});

test('a matched group carries no children into the result list', () => {
	const { matches } = filterTree(sampleTree(), 'Guides');

	const group = matches.find((node) => node.doc_key === 'g1');
	assert.ok(group, 'the group is a result in its own right');
	assert.deepEqual(group.children, [], 'its pages are not results');
});

test('results are ranked, best match first', () => {
	const { matches } = filterTree(sampleTree(), 'guides');

	assert.equal(matches[0].doc_key, 'g1', 'the exact title beats route hits');
});

test('matches the route even when the title does not', () => {
	// "auth-tokens" lives only in p2's route, not its title ("Authentication").
	const { matches, score } = filterTree(sampleTree(), 'auth-tokens');

	assert.ok(has(matches, 'p2'), 'route-only hit surfaces the page');
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

test('a strong (prefix) fuzzy query still matches', () => {
	const { matches } = filterTree(sampleTree(), 'authen');
	assert.ok(has(matches, 'p2'));
});

// Mirrors the reported space (Getting Started / Guides·Advanced / Reference·CLI).
function prodTree() {
	return [
		{
			doc_key: 'gGS',
			title: 'Getting Started',
			route: 'once/getting-started',
			is_group: true,
			children: [
				{
					doc_key: 'pInstall',
					title: 'Install It',
					route: 'once/getting-started/installation',
					children: [],
				},
			],
		},
		{
			doc_key: 'gAdv',
			title: 'Advanced',
			route: 'once/guides/advanced',
			is_group: true,
			children: [
				{
					doc_key: 'pTrouble',
					title: 'Troubleshooting',
					route: 'once/guides/advanced/troubleshooting',
					children: [],
				},
			],
		},
		{
			doc_key: 'gCLI',
			title: 'CLI',
			route: 'once/reference/cli',
			is_group: true,
			children: [
				{
					doc_key: 'pCLICmd',
					title: 'CLI Commands',
					route: 'once/reference/cli/cli-commands',
					children: [],
				},
			],
		},
	];
}

test('"cli" surfaces the CLI pages and drops route-scatter junk', () => {
	const { matches } = filterTree(prodTree(), 'cli');
	assert.ok(has(matches, 'pCLICmd'), 'CLI Commands kept');
	assert.ok(has(matches, 'gCLI'), 'CLI group kept');
	// Both matched "cli" only as a scattered subsequence of their long routes
	// (c…l…i across ".../installation"), title score 0 — must be dropped.
	assert.ok(
		!has(matches, 'pInstall'),
		'Install It (route-scatter only) dropped',
	);
	assert.ok(
		!has(matches, 'pTrouble'),
		'Troubleshooting (route-scatter only) dropped',
	);
});

test('"stat" still finds "Getting Started" (lenient title threshold)', () => {
	const { matches } = filterTree(prodTree(), 'stat');
	assert.ok(
		has(matches, 'gGS'),
		'near-prefix "stat" matches "Getting Started"',
	);
});

test('no matches yields an empty result list', () => {
	const { matches } = filterTree(sampleTree(), 'zzzznomatch');
	assert.equal(matches.length, 0);
});

test('highlightSegments keeps markup as literal text (no HTML injection)', () => {
	// A wiki author could title a page with markup; segments must carry it as
	// plain text so Vue escapes it, never as an HTML string for v-html.
	const result = fuzzysort.go('cli', ['<img src=x onerror=alert(1)> CLI'])[0];
	const segs = highlightSegments(result);

	// Reassembled text equals the original target exactly — nothing parsed away.
	assert.equal(
		segs.map((s) => s.text).join(''),
		'<img src=x onerror=alert(1)> CLI',
	);
	// Only the query chars are marked; the markup sits in a plain segment.
	assert.equal(
		segs
			.filter((s) => s.matched)
			.map((s) => s.text)
			.join(''),
		'CLI',
	);
	assert.ok(segs.some((s) => !s.matched && s.text.includes('<img')));
});

test('highlightSegments returns null when the key did not match', () => {
	assert.equal(highlightSegments(null), null);
	assert.equal(highlightSegments({ target: '', indexes: [] }), null);
});
