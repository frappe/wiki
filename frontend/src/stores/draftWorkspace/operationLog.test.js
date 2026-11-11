import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

import { createOperationLog } from './operationLog.js';
import { createOperationQueue } from './operationQueue.js';

vi.mock('@/stores/draftPersistence', () => ({
	clearLogEntry: () => Promise.resolve(),
	loadLogForCr: () => Promise.resolve([]),
	saveLogEntry: () => Promise.resolve(),
}));

function createLog() {
	const queue = createOperationQueue();
	const log = createOperationLog({ queue, crName: () => 'CR-1' });
	return { queue, log };
}

test('a page is pending from its first entry until its last one leaves', () => {
	const { queue, log } = createLog();

	log.append('delete_node', { docKey: 'page' });
	log.append('restore_node', { docKey: 'page' });
	assert.equal(log.isPending('page'), true);
	assert.equal(log.isPending('other'), false);

	const [deleted, restored] = queue.pending.value;
	queue.clear(deleted.id);
	assert.equal(log.isPending('page'), true);
	queue.clear(restored.id);
	assert.equal(log.isPending('page'), false);
});

test('a content save does not make a page pending', () => {
	const { queue, log } = createLog();
	queue.enqueue('update_content', { docKey: 'page' });
	assert.equal(log.isPending('page'), false);
});
