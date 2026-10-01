import assert from 'node:assert/strict';
import test from 'node:test';

import { MarkdownManager } from '@tiptap/markdown';

import { WikiLink } from './link-extension.js';
import {
	docKeyFromHref,
	findPageByTitle,
	linkablePages,
	pickerItems,
	rankPages,
} from './page-links.js';
import { wikiStarterKit } from './wiki-starterkit.js';

const TREE = [
	{ doc_key: 'intro', title: 'Introduction', is_group: 0 },
	{
		doc_key: 'guides',
		title: 'Guides',
		is_group: 1,
		children: [
			{ doc_key: 'setup', title: 'Setup Guide', is_group: 0 },
			{
				doc_key: 'draft',
				title: 'Draft Notes',
				is_group: 0,
				is_published: false,
			},
			{ doc_key: 'old', title: 'Old Setup', is_group: 0, is_deleted: true },
			{ doc_key: 'gh', title: 'GitHub', is_group: 0, is_external_link: 1 },
		],
	},
];

test('linkablePages lists pages in tree order with their folder trail', () => {
	assert.deepEqual(
		linkablePages(TREE).map(({ key, trail, isPublished }) => [
			key,
			trail,
			isPublished,
		]),
		[
			['intro', [], true],
			['setup', ['Guides'], true],
			['draft', ['Guides'], false],
		],
	);
});

test('rankPages puts a title prefix before a word start before a substring', () => {
	const pages = [
		{ key: 'sub', title: 'Resetting' },
		{ key: 'word', title: 'Quick Setup' },
		{ key: 'prefix', title: 'Setup Guide' },
	];
	assert.deepEqual(
		rankPages(pages, 'SET').map((page) => page.key),
		['prefix', 'word', 'sub'],
	);
});

test('rankPages falls back to scattered letters only when nothing contains the query', () => {
	const pages = [
		{ key: 'intro', title: 'Introduction' },
		{ key: 'setup', title: 'Setup Guide' },
	];
	assert.deepEqual(
		rankPages(pages, 'stgd').map((page) => page.key),
		['setup'],
	);
	assert.deepEqual(
		rankPages(pages, 'intro').map((page) => page.key),
		['intro'],
	);
});

test('rankPages shows at most eight pages', () => {
	const pages = Array.from({ length: 12 }, (_, i) => ({
		key: `p${i}`,
		title: `Page ${i}`,
	}));
	assert.equal(rankPages(pages, '').length, 8);
});

test('pickerItems offers to create a page only when no page has the name', () => {
	const pages = [
		{ key: 'open', title: 'Open Page' },
		{ key: 'setup', title: 'Setup Guide' },
	];
	const keys = (query) =>
		pickerItems(pages, query, 'open').map((item) => item.key);

	assert.deepEqual(keys(''), ['setup']);
	assert.deepEqual(keys('setup guide'), ['setup']);
	// The open page is not offered as a link, but its name is still taken.
	assert.deepEqual(keys('open page'), []);
	assert.deepEqual(keys('Deploy'), ['create']);
	assert.equal(pickerItems(pages, ' Deploy ', 'open')[0].title, 'Deploy');
});

test('findPageByTitle matches the whole title, ignoring case', () => {
	const pages = [{ key: 'setup', title: 'Setup Guide' }];
	assert.equal(findPageByTitle(pages, 'setup guide')?.key, 'setup');
	assert.equal(findPageByTitle(pages, 'setup'), null);
});

test('docKeyFromHref reads only wiki: links', () => {
	assert.equal(docKeyFromHref('wiki:setup'), 'setup');
	assert.equal(docKeyFromHref('https://wiki.example.com'), null);
	assert.equal(docKeyFromHref(null), null);
});

// The link must survive the editor's markdown round-trip untouched, or saving
// a page would rewrite `wiki:` links into something the reader can't resolve.
test('a wiki: link round-trips through the editor markdown', () => {
	const starterKit = wikiStarterKit();
	const manager = new MarkdownManager({
		extensions: [
			...starterKit.config.addExtensions.call({
				options: starterKit.options,
				name: 'starterKit',
			}),
			WikiLink,
		],
		markedOptions: { breaks: true },
	});
	const markdown = 'See [Setup Guide](wiki:a1b2c3d4e5f6) first.';
	assert.equal(manager.serialize(manager.parse(markdown)), markdown);
});
