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

function legacyNode(model, docKey) {
	const find = (nodes) => {
		for (const node of nodes) {
			if (node.doc_key === docKey) return node;
			const found = find(node.children);
			if (found) return found;
		}
		return null;
	};
	return find(model.treeAsLegacy.value.children);
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
	assert.deepEqual(
		model.treeAsLegacy.value.children.map((n) => n.doc_key),
		['new'],
	);
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
	assert.equal(legacyNode(model, 'child2').is_deleted, true);
	assert.equal(model.findNode('page').isDeleted, false);

	model.setSubtreeDeleted('group', false);
	assert.equal(legacyNode(model, 'group').is_deleted, false);
	assert.equal(legacyNode(model, 'child').is_deleted, false);
});

test('the legacy view nests records in child list order', () => {
	const model = loaded();
	model.moveNode('child2', 'group', 0);
	const view = model.treeAsLegacy.value;

	assert.equal(view.root_group, 'root');
	assert.deepEqual(
		view.children.map((n) => n.doc_key),
		['group', 'page'],
	);
	assert.deepEqual(
		view.children[0].children.map((n) => n.title),
		['Child 2', 'Child'],
	);
	assert.equal(view.children[0].children[1].is_published, false);
});

test('a row is pending only while the log holds an entry for it', () => {
	const pending = new Set(['page']);
	const model = loaded({ isPending: (key) => pending.has(key) });

	assert.equal(legacyNode(model, 'page').is_pending, true);
	assert.equal(legacyNode(model, 'child').is_pending, false);
});

test('reset empties the model', () => {
	const model = loaded();
	model.reset();
	assert.equal(model.rootKey.value, null);
	assert.equal(model.findNode('page'), null);
	assert.deepEqual(model.treeAsLegacy.value.children, []);
});
