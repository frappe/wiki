import assert from 'node:assert/strict';
import test from 'node:test';

import { createMoveScheduler } from './moveScheduler.js';

function createFakeQueue(docKey) {
	const pending = [
		{ id: 'move-1', type: 'move_node', payload: { docKey }, status: 'queued' },
	];
	return {
		pending: { value: pending },
		setStatus(id, status) {
			pending.find((m) => m.id === id).status = status;
		},
		clear(id) {
			pending.splice(
				pending.findIndex((m) => m.id === id),
				1,
			);
		},
	};
}

test('a failed draft request fails the move and does not stall the next one', async () => {
	const queue = createFakeQueue('page');
	let draftRequests = 0;
	let batches = 0;
	const mover = createMoveScheduler({
		resolver: { resolveDocKey: async (key) => key, resolveKey: (key) => key },
		queue,
		treeModel: { findNode: () => null, getChildList: () => [] },
		transport: {
			applyBatchOps: async () => {
				batches++;
			},
		},
		useBatchOperations: true,
		crStore: {},
		crName: () => 'CR-1',
		ensureCr: async () => {
			if (!draftRequests++) throw new Error('network down');
			return true;
		},
		scheduleSummaryRefresh: () => {},
		errorMessage: (err) => err.message,
	});

	mover.recordMove('page', 'root');
	await mover.flush();
	assert.equal(queue.pending.value[0].status, 'failed');

	mover.recordMove('page', 'root');
	await mover.flush();
	assert.equal(batches, 1);
});
