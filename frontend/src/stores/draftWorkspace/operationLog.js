import {
	clearLogEntry,
	loadLogForCr,
	saveLogEntry,
} from '@/stores/draftPersistence';
import { computed } from 'vue';
import { isRetryableError } from './utils';

const LOGGED_TYPES = new Set([
	'create_node',
	'update_node',
	'delete_node',
	'restore_node',
	'move_node',
]);
const MOVE_DEBOUNCE_MS = 750;
const MAX_BACKOFF_MS = 15000;

function isSignedOut() {
	return document.cookie.includes('user_id=Guest');
}

// Durable, ordered log of tree and metadata changes. An entry reaches IndexedDB
// before it is sent and leaves once the server answers, so a reload resumes
// where the last page stopped. Content stays out: drafts already keep it.
//
// One batch goes out at a time. Its ops never change once sent, so a retry
// after a lost reply carries the same `op_id`s and the server skips what landed.
export function createOperationLog({
	queue,
	transport,
	crName,
	toOperations,
	onAcknowledged,
	onRejected,
	onTreeVersionUnknown,
	onUnattendedRejection,
}) {
	const waiters = new Map();
	const writes = new Map();
	let run = 0;
	let started = false;
	let draining = false;
	let wake = null;
	let lastSeq = 0;

	function entries() {
		return queue.pending.value.filter((m) => LOGGED_TYPES.has(m.type));
	}

	// A page is pending exactly while an entry for it is unacknowledged.
	const pendingKeys = computed(
		() => new Set(entries().map((entry) => entry.payload.docKey)),
	);

	function isPending(docKey) {
		return pendingKeys.value.has(docKey);
	}

	function waiter(id) {
		if (!waiters.has(id)) {
			const entry = {};
			entry.promise = new Promise((resolve, reject) => {
				entry.resolve = resolve;
				entry.reject = reject;
			});
			waiters.set(id, entry);
		}
		return waiters.get(id);
	}

	function settle(id, method, value) {
		waiters.get(id)?.[method](value);
		waiters.delete(id);
		writes.delete(id);
	}

	// The write starts in the tick of the UI update, and the batch waits for it.
	function append(type, payload) {
		const entry = queue.enqueue(type, payload);
		lastSeq = Math.max(Date.now(), lastSeq + 1);
		entry.seq = lastSeq;
		writes.set(entry.id, saveLogEntry(crName(), entry));
		const { promise } = waiter(entry.id);
		drain();
		wakeUp();
		return promise;
	}

	function pendingCreate(docKey) {
		return entries().find(
			(m) => m.type === 'create_node' && m.payload?.docKey === docKey,
		);
	}

	function whenCreated(docKey) {
		const create = pendingCreate(docKey);
		return create ? waiter(create.id).promise : Promise.resolve();
	}

	// Picks up what an earlier page or another tab left. A second sender is safe:
	// the server dedupes by `op_id`.
	async function load(cr) {
		const stored = await loadLogForCr(cr);
		if (crName() !== cr) return;
		const known = new Set(entries().map((m) => m.id));
		for (const entry of stored) {
			if (known.has(entry.id)) continue;
			queue.restore({
				...entry,
				status: entry.held ? 'failed' : 'queued',
			});
			lastSeq = Math.max(lastSeq, entry.seq);
			waiter(entry.id).promise.catch(onUnattendedRejection);
		}
		queue.pending.value.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	}

	function start() {
		started = true;
		drain();
	}

	function nextBatch() {
		const sendable = entries().filter((m) => m.status !== 'failed');
		const head = sendable[0];
		if (!head) return { batch: null };
		if (head.type !== 'move_node') return { batch: [head] };
		const end = sendable.findIndex((m) => m.type !== 'move_node');
		const moves = end === -1 ? sendable : sendable.slice(0, end);
		const newest = moves[moves.length - 1];
		return {
			batch: moves,
			waitMs: newest.createdAt + MOVE_DEBOUNCE_MS - Date.now(),
		};
	}

	function pause(ms) {
		return new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			wake = () => {
				clearTimeout(timer);
				resolve();
			};
		});
	}

	function wakeUp() {
		const resume = wake;
		wake = null;
		resume?.();
	}

	async function drain() {
		if (draining || !started) return;
		draining = true;
		const thisRun = run;
		try {
			while (thisRun === run) {
				const { batch, waitMs } = nextBatch();
				if (!batch) return;
				if (waitMs > 0) {
					await pause(waitMs);
					continue;
				}
				await send(batch, thisRun);
			}
		} finally {
			if (thisRun === run) draining = false;
		}
	}

	async function send(batch, thisRun) {
		const cr = crName();
		for (const entry of batch) queue.setStatus(entry.id, 'syncing');
		const operations = toOperations(batch);
		await Promise.all(batch.map((entry) => writes.get(entry.id)));

		for (let attempt = 0; thisRun === run; attempt++) {
			try {
				const result = await transport.applyBatchOps(operations, cr);
				finish(batch, cr);
				if (thisRun !== run) return;
				onAcknowledged(batch, result);
				for (const entry of batch) settle(entry.id, 'resolve');
				// A failed attempt may have landed, so the version here may be behind.
				if (
					attempt > 0 &&
					batch.some((entry) => entry.type !== 'update_node')
				) {
					await onTreeVersionUnknown();
				}
				return;
			} catch (err) {
				if (err.code === 'version_conflict') {
					if (thisRun === run) hold(batch, cr, err);
					return;
				}
				if (!isRetryableError(err, isSignedOut())) {
					finish(batch, cr);
					if (thisRun !== run) return;
					await onRejected(batch);
					for (const entry of batch) settle(entry.id, 'reject', err);
					return;
				}
				await pause(Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS));
			}
		}
	}

	function finish(batch, cr) {
		for (const entry of batch) {
			clearLogEntry(cr, entry.id);
			queue.clear(entry.id);
		}
	}

	function hold(batch, cr, err) {
		for (const entry of batch) {
			queue.setStatus(entry.id, 'failed', err.message);
			entry.held = true;
			saveLogEntry(cr, entry);
		}
	}

	function hasHeld() {
		return entries().some((m) => m.held);
	}

	// A newer drag replaces queued moves of that page. One already sent stays.
	function dropQueuedMoves(docKey) {
		drop(
			(m) =>
				m.type === 'move_node' &&
				m.payload?.docKey === docKey &&
				m.status !== 'syncing',
		);
	}

	function discardHeld() {
		drop((m) => m.held);
	}

	function drop(predicate) {
		const cr = crName();
		for (const entry of entries().filter(predicate)) {
			clearLogEntry(cr, entry.id);
			queue.clear(entry.id);
			settle(entry.id, 'resolve');
		}
	}

	// Unsent entries stay in IndexedDB for the next visit to this change request.
	// The promises resolve so no caller is left waiting on a page it has left.
	function reset() {
		run += 1;
		started = false;
		draining = false;
		wakeUp();
		for (const id of [...waiters.keys()]) settle(id, 'resolve');
	}

	return {
		entries,
		isPending,
		append,
		pendingCreate,
		whenCreated,
		load,
		start,
		hasHeld,
		dropQueuedMoves,
		discardHeld,
		reset,
	};
}
