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

	// A new save of a page replaces its failed one, so a successful retry
	// doesn't leave the workspace stuck behind a stale failure.
	function dropFailedContent(docKey) {
		pending.value = pending.value.filter(
			(m) =>
				!(
					m.status === 'failed' &&
					m.type === 'update_content' &&
					m.payload?.docKey === docKey
				),
		);
	}

	function restore(mutation) {
		pending.value.push(mutation);
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
		dropFailedContent,
		restore,
		clearFailed,
		reset,
	};
}
