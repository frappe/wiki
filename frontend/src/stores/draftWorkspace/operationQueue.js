import { computed, ref } from 'vue';

function makeMutationId() {
	const rand =
		globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
	return `m_${rand}`;
}

// Pending-mutations queue. Each mutation has { id, type, status, payload }.
export function createOperationQueue() {
	const pending = ref([]);

	const hasPendingMutations = computed(() =>
		pending.value.some((m) => m.status === 'queued' || m.status === 'syncing'),
	);
	const hasFailedMutations = computed(() =>
		pending.value.some((m) => m.status === 'failed'),
	);

	function enqueue(type, payload) {
		const mutation = {
			id: makeMutationId(),
			type,
			status: 'queued',
			payload,
			createdAt: Date.now(),
			error: null,
		};
		pending.value.push(mutation);
		return mutation;
	}

	function setStatus(id, status, error = null) {
		const mutation = pending.value.find((m) => m.id === id);
		if (!mutation) return;
		mutation.status = status;
		mutation.error = error;
	}

	function clear(id) {
		pending.value = pending.value.filter((m) => m.id !== id);
	}

	// Identifies the (logical) target a mutation operates on. A new mutation
	// for the same target supersedes prior failed mutations against it — so
	// a successful retry doesn't leave the workspace stuck behind a stale
	// failure that hasFailedMutations / submit-merge gating reacts to.
	function supersessionKey(mutation) {
		if (!mutation) return null;
		const { type, payload } = mutation;
		if (type === 'create_node') return `create:${payload?.docKey}`;
		if (type === 'update_node') return `update:${payload?.docKey}`;
		if (type === 'delete_node' || type === 'restore_node')
			return `delete:${payload?.docKey}`;
		if (type === 'move_node') return `move:${payload?.docKey}`;
		if (type === 'update_content') return `content:${payload?.docKey}`;
		return null;
	}

	function supersedeFailedFor(key) {
		if (!key) return;
		pending.value = pending.value.filter(
			(m) => !(m.status === 'failed' && supersessionKey(m) === key),
		);
	}

	function findFailedCreate(docKey) {
		return pending.value.find(
			(m) =>
				m.type === 'create_node' &&
				m.payload?.docKey === docKey &&
				m.status === 'failed',
		);
	}

	// Drop any mutation matching the given predicate. Used by deleteNode
	// (drop stranded failed-creates for an unsynced temp) and moveNode
	// (coalesce queued/failed moves before enqueueing a fresh one).
	function dropMatching(predicate) {
		pending.value = pending.value.filter((m) => !predicate(m));
	}

	// Drop every failed mutation. Used by `Reload latest` recovery after
	// the user has explicitly adopted server state as truth.
	function clearFailed() {
		pending.value = pending.value.filter((m) => m.status !== 'failed');
	}

	function reset() {
		pending.value = [];
	}

	return {
		pending,
		hasPendingMutations,
		hasFailedMutations,
		enqueue,
		setStatus,
		clear,
		supersessionKey,
		supersedeFailedFor,
		findFailedCreate,
		dropMatching,
		clearFailed,
		reset,
	};
}
