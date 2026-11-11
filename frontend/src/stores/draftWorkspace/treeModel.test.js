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
				children: [{ doc_key: 'child', title: 'Child' }],
			},
			{ doc_key: 'page', title: 'Page' },
		],
	};
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

test('restore after delete clears the flag over the whole subtree', () => {
	const model = createTreeModel();
	model.applyServerTree(serverTree());

	model.setSubtreeDeleted('group', true);
	assert.equal(legacyNode(model, 'group').is_deleted, true);
	assert.equal(legacyNode(model, 'child').is_deleted, true);

	model.setSubtreeDeleted('group', false);
	assert.equal(legacyNode(model, 'group').is_deleted, false);
	assert.equal(legacyNode(model, 'child').is_deleted, false);
	assert.equal(legacyNode(model, 'page').is_deleted, false);
});

test('a row is pending only while the log holds an entry for it', () => {
	const pending = new Set(['page']);
	const model = createTreeModel({ isPending: (key) => pending.has(key) });
	model.applyServerTree(serverTree());

	assert.equal(legacyNode(model, 'page').is_pending, true);
	assert.equal(legacyNode(model, 'child').is_pending, false);
});
