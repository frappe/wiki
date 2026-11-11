import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createTreeModel } from './treeModel.js';

function serverTree() {
	return {
		root_group: 'root',
		children: [
			{
				doc_key: 'group',
				title: 'Group',
				is_group: 1,
				children: [
					{ doc_key: 'child', title: 'Child', is_published: 0 },
					{ doc_key: 'child2', title: 'Child 2', is_published: 1 },
				],
			},
			{ doc_key: 'page', title: 'Page' },
		],
	};
}

function loaded(options) {
	const model = createTreeModel(options);
	model.applyServerTree(serverTree());
	return model;
}

function keys(records) {
	return records.map((record) => record.docKey);
}

test('a server tree becomes one record per page and ordered child lists', () => {
	const model = loaded();

	assert.deepEqual(model.childKeys(null), ['group', 'page']);
	assert.deepEqual(model.childKeys('root'), ['group', 'page']);
	assert.deepEqual(model.childKeys('group'), ['child', 'child2']);
	assert.deepEqual(model.childKeys('page'), []);
	assert.equal(model.childKeys('missing'), null);

	assert.equal(model.findNode('child').parentKey, 'group');
	assert.equal(model.findNode('group').parentKey, 'root');
	assert.equal(model.findNode('missing'), null);
	assert.equal('children' in model.findNode('group'), false);
});

test('a server checkbox 0 reads as unpublished', () => {
	const model = loaded();
	assert.equal(model.findNode('child').isPublished, false);
	assert.equal(model.findNode('child2').isPublished, true);
	assert.equal(model.findNode('page').isPublished, true);
});

test('insert appends under a known parent and ignores an unknown one', () => {
	const model = loaded();
	model.insertNode({ docKey: 'new', title: 'New' }, 'group');
	model.insertNode({ docKey: 'lost', title: 'Lost' }, 'missing');

	assert.deepEqual(model.childKeys('group'), ['child', 'child2', 'new']);
	assert.equal(model.findNode('new').parentKey, 'group');
	assert.equal(model.findNode('lost'), null);
});

test('insert before any tree loads files the page at the top level', () => {
	const model = createTreeModel();
	model.insertNode({ docKey: 'new', title: 'New' }, null);
	assert.deepEqual(model.childKeys(null), ['new']);
	assert.deepEqual(keys(model.children(null)), ['new']);
	assert.deepEqual(model.trail('new'), [model.findNode('new')]);
});

test('setFields updates a known page in place', () => {
	const model = loaded();
	model.setFields('child', { title: 'Renamed', isPublished: true });

	assert.equal(model.findNode('child').title, 'Renamed');
	assert.equal(model.findNode('child').isPublished, true);
	assert.equal(model.findNode('child').parentKey, 'group');
	assert.equal(model.children('group')[0].title, 'Renamed');
});

test('setFields before the tree loads makes a record outside the tree', () => {
	const model = createTreeModel();
	model.setFields('early', { title: 'Early', route: 'space/early' });

	assert.equal(model.findNode('early').title, 'Early');
	assert.equal(model.findNode('early').parentKey, null);
	assert.deepEqual(model.childKeys(null), []);
	assert.equal(model.trail('early'), null);

	model.applyServerTree(serverTree());
	assert.equal(model.findNode('early'), null);
});

test('move reorders inside one parent', () => {
	const model = loaded();
	model.moveNode('child2', 'group', 0);
	assert.deepEqual(model.childKeys('group'), ['child2', 'child']);
});

test('move across parents updates both lists and the parent key', () => {
	const model = loaded();
	model.moveNode('child', 'root', 1);

	assert.deepEqual(model.childKeys(null), ['group', 'child', 'page']);
	assert.deepEqual(model.childKeys('group'), ['child2']);
	assert.equal(model.findNode('child').parentKey, 'root');
});

test('move clamps the index and ignores an unknown parent', () => {
	const model = loaded();
	model.moveNode('page', 'group', 99);
	assert.deepEqual(model.childKeys('group'), ['child', 'child2', 'page']);

	model.moveNode('page', 'missing', 0);
	assert.deepEqual(model.childKeys('group'), ['child', 'child2', 'page']);
});

test('restore after delete clears the flag over the whole subtree', () => {
	const model = loaded();

	model.setSubtreeDeleted('group', true);
	assert.equal(model.findNode('group').isDeleted, true);
	assert.equal(model.findNode('child').isDeleted, true);
	assert.equal(model.findNode('child2').isDeleted, true);
	assert.equal(model.findNode('page').isDeleted, false);

	model.setSubtreeDeleted('group', false);
	assert.equal(model.findNode('group').isDeleted, false);
	assert.equal(model.findNode('child').isDeleted, false);
});

test('children are records in child list order', () => {
	const model = loaded();
	model.moveNode('child2', 'group', 0);

	assert.deepEqual(keys(model.children(null)), ['group', 'page']);
	assert.deepEqual(
		model.children('group').map((record) => record.title),
		['Child 2', 'Child'],
	);
	assert.deepEqual(model.children('missing'), []);
});

test('pages lists every record depth first in tree order', () => {
	const model = loaded();
	assert.deepEqual(keys(model.pages()), ['group', 'child', 'child2', 'page']);
	assert.deepEqual(keys(model.pages('group')), ['child', 'child2']);
});

test('trail runs from the top-level ancestor down to the page', () => {
	const model = loaded();
	assert.deepEqual(keys(model.trail('child2')), ['group', 'child2']);
	assert.deepEqual(keys(model.trail('page')), ['page']);
	assert.equal(model.trail('missing'), null);

	model.moveNode('child2', 'root', 0);
	assert.deepEqual(keys(model.trail('child2')), ['child2']);
});

test('nodeByDocumentName finds pages the server has saved', () => {
	const model = createTreeModel();
	model.applyServerTree({
		root_group: 'root',
		children: [
			{ doc_key: 'a', document_name: 'doc-a', title: 'A' },
			{ doc_key: 'b', document_name: null, title: 'B' },
		],
	});

	assert.equal(model.nodeByDocumentName('doc-a').docKey, 'a');
	assert.equal(model.nodeByDocumentName('missing'), null);
	assert.equal(model.nodeByDocumentName(null), null);
});

test('firstPage skips deleted pages, unsaved pages and empty groups', () => {
	const model = createTreeModel();
	model.applyServerTree({
		root_group: 'root',
		children: [
			{ doc_key: 'empty', document_name: 'd-empty', is_group: 1 },
			{ doc_key: 'gone', document_name: 'd-gone', is_deleted: 1 },
			{ doc_key: 'draft', document_name: null },
			{
				doc_key: 'group',
				document_name: 'd-group',
				is_group: 1,
				children: [{ doc_key: 'inner', document_name: 'd-inner' }],
			},
			{ doc_key: 'last', document_name: 'd-last' },
		],
	});

	assert.equal(model.firstPage(), 'd-inner');
	model.setSubtreeDeleted('group', true);
	assert.equal(model.firstPage(), 'd-last');
	assert.equal(model.firstPage('empty'), null);
});

test('linkablePages skips deleted pages and external links', () => {
	const model = createTreeModel();
	model.applyServerTree({
		root_group: 'root',
		children: [
			{
				doc_key: 'guides',
				title: 'Guides',
				is_group: 1,
				children: [
					{ doc_key: 'setup', title: 'Setup', is_published: 0 },
					{ doc_key: 'gone', title: 'Gone', is_deleted: 1 },
				],
			},
			{ doc_key: 'site', title: 'Site', is_external_link: 1 },
			{ doc_key: 'faq', title: 'FAQ' },
		],
	});

	assert.deepEqual(model.linkablePages(), [
		{ key: 'setup', title: 'Setup', trail: ['Guides'], isPublished: false },
		{ key: 'faq', title: 'FAQ', trail: [], isPublished: true },
	]);
});

test('the live tree shape loads with document names and its root key', () => {
	const model = createTreeModel();
	model.applyServerTree({
		root_group: 'root-doc-name',
		root_key: 'root',
		children: [
			{
				name: 'doc-g',
				doc_key: 'g',
				title: 'G',
				is_group: 1,
				children: [{ name: 'doc-p', doc_key: 'p', title: 'P' }],
			},
		],
	});

	assert.equal(model.rootKey.value, 'root');
	assert.equal(model.findNode('p').documentName, 'doc-p');
	assert.equal(model.findNode('g').parentKey, 'root');
	assert.deepEqual(keys(model.trail('p')), ['g', 'p']);
});

test('reset empties the model', () => {
	const model = loaded();
	model.reset();
	assert.equal(model.rootKey.value, null);
	assert.equal(model.findNode('page'), null);
	assert.deepEqual(model.children(null), []);
});
