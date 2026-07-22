import { computed, ref } from 'vue';

function makeMutationId() {
	const rand =
		globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
	return `m_${rand}`;
}

// Pending-mutations queue. Each mutation has { id, type, status, payload }.
// `resolveKey` is injected so the supersession key for a mutation can
// normalize tmp_* payloads to their real key once resolved — without that,
// a mutation enqueued before its create resolved wouldn't coalesce with
// later same-target mutations.
export function createOperationQueue({ resolveKey }) {
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
		const r = (k) => resolveKey(k) || k;
		if (type === 'create_node') return `create:${payload?.tempKey}`;
		if (type === 'update_node') return `update:${r(payload?.docKey)}`;
		if (type === 'delete_node') return `delete:${r(payload?.docKey)}`;
		if (type === 'move_node') return `move:${r(payload?.docKey)}`;
		if (type === 'update_content') return `content:${r(payload?.docKey)}`;
		return null;
	}

	function supersedeFailedFor(key) {
		if (!key) return;
		pending.value = pending.value.filter(
			(m) => !(m.status === 'failed' && supersessionKey(m) === key),
		);
	}

	function findFailedCreate(tempKey) {
		return pending.value.find(
			(m) =>
				m.type === 'create_node' &&
				m.payload?.tempKey === tempKey &&
				m.status === 'failed',
		);
	}

	// Drop any mutation matching the given predicate. Used by deleteNode
	// (drop stranded failed-creates for an unsynced temp) and moveNode
	// (coalesce queued/failed moves before enqueueing a fresh one).
	function dropMatching(predicate) {
		pending.value = pending.value.filter((m) => !predicate(m));
	}

	// Rewrite payload docKey/parentKey references from a tmp_* key to its
	// real key once a create resolves. Without this, a stale tmp-keyed
	// entry would never coalesce with future real-keyed activity, and
	// stale failed mutations under the tmp key wouldn't be reachable for
	// supersession by their target's natural key.
	function rewriteKeys(oldKey, newKey) {
		if (!oldKey || !newKey || oldKey === newKey) return;
		for (const m of pending.value) {
			const p = m.payload;
			if (!p) continue;
			if (p.docKey === oldKey) p.docKey = newKey;
			if (p.targetParentKey === oldKey) p.targetParentKey = newKey;
			if (p.parentKey === oldKey) p.parentKey = newKey;
		}
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
		rewriteKeys,
		clearFailed,
		reset,
	};
}
