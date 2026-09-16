import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResultGroups } from './commandPalette.js';

const titles = {
	jump: 'Jump to',
	spaces: 'Spaces',
	pages: 'Pages',
	recent: 'Recent',
};
const jumpTo = [{ key: 'overview', label: 'All Spaces' }];
const spaces = [
	{ key: 'space:docs', label: 'Docs' },
	{ key: 'space:eng', label: 'Engineering' },
];
const pages = [
	{ key: 'page:1', label: 'Deploying to production', path: 'deploying' },
	{ key: 'page:2', label: 'Getting Started', path: 'guides/getting-started' },
	{ key: 'page:3', label: 'Onboarding', path: 'release-howto' },
];
const recent = [{ key: 'page:9', label: 'Release notes' }];

function build(query, overrides = {}) {
	return buildResultGroups(query, {
		jumpTo,
		spaces,
		pages,
		recent,
		titles,
		...overrides,
	});
}

function labels(groups) {
	return groups.map((group) => [group.id, group.items.map((i) => i.label)]);
}

test('offers destinations and recent pages for an empty query', () => {
	assert.deepEqual(labels(build('  ')), [
		['jump', ['All Spaces']],
		['recent', ['Release notes']],
	]);
});

test('drops the recent group when there is nothing recent', () => {
	assert.deepEqual(labels(build('', { recent: [] })), [
		['jump', ['All Spaces']],
	]);
});

test('drops groups with no matches', () => {
	assert.deepEqual(labels(build('engin')), [['spaces', ['Engineering']]]);
});

test('matches a page by its path, not its title', () => {
	assert.deepEqual(labels(build('howto')), [['pages', ['Onboarding']]]);
	assert.equal(labels(build('onboarding')).length, 0);
});

test('matches words typed with spaces against a hyphenated path', () => {
	assert.deepEqual(labels(build('getting started')), [
		['pages', ['Getting Started']],
	]);
	assert.deepEqual(labels(build('guides/get')), [
		['pages', ['Getting Started']],
	]);
});

test('drops stale page rows that no longer match the query', () => {
	assert.equal(build('deploy').find((g) => g.id === 'pages').items.length, 1);
});

test('ignores page rows below the server query length', () => {
	assert.equal(
		build('d').some((group) => group.id === 'pages'),
		false,
	);
});

test('lifts a page in the current space over a better match elsewhere', () => {
	// Bare 'deploy' is the stronger path match, but the biased row wins.
	const biased = [
		{ key: 'page:1', label: 'Deploy', path: 'deploy' },
		{
			key: 'page:2',
			label: 'Deployment checklist',
			path: 'deployment-checklist',
			scoreScale: 1.5,
		},
	];
	const options = { pages: biased, jumpTo: [], spaces: [] };
	const [group] = build('deploy', options);
	assert.deepEqual(
		group.items.map((item) => item.key),
		['page:2', 'page:1'],
	);

	const plain = biased.map(({ scoreScale, ...item }) => item);
	const [unbiased] = build('deploy', { ...options, pages: plain });
	assert.equal(unbiased.items[0].key, 'page:1');
});

test('lists actions above recent pages for an empty query', () => {
	const actions = [{ key: 'toggle-theme', label: 'Toggle theme' }];
	assert.deepEqual(labels(build('', { actions })), [
		['jump', ['All Spaces']],
		['actions', ['Toggle theme']],
		['recent', ['Release notes']],
	]);
});

test('matches an action by an alias it does not render', () => {
	const actions = [
		{
			key: 'toggle-theme',
			label: 'Toggle theme',
			search: 'toggle theme dark light mode',
		},
	];
	assert.deepEqual(labels(build('dark', { actions })), [
		['actions', ['Toggle theme']],
	]);
});
