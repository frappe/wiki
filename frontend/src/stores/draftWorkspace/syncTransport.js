import { createResource } from 'frappe-ui';
import { reactive, ref } from 'vue';

// All backend transport for the workspace: tree/page fetches and the
// batched `apply_cr_operations` endpoint. Owns per-CR sync state
// (tail + last-known operation_version) and the `sync` reactive that
// drives the contribution-banner / sync-pill UI.
//
// `crName` is injected as a getter so transport reads the current CR
// at call time (a workspace switch mid-batch must not retarget an
// in-flight call to the new CR).
export function createSyncTransport({ crStore, crName }) {
	// Last `operation_version` we know the server is on for the active
	// CR. Sent as `base_version` on the next batch so the server can
	// detect concurrent edits and reject with a structured conflict
	// instead of clobbering.
	const operationVersion = ref(null);

	const sync = reactive({
		status: 'idle', // 'idle' | 'saving' | 'failed'
		lastSavedAt: null,
		error: null,
		conflict: false,
	});

	// Per-CR sync state: tail (so same-CR batches serialize and never race
	// on base_version) and the latest known version. Keyed by CR name so
	// a mid-flight workspace switch can't reroute a queued batch to a
	// different CR — each CR has its own tail/version, captured at enqueue
	// time. The map is intentionally not cleared on `reset()`: pending
	// batches for an abandoned CR still need to resolve against their
	// captured CR, and re-entering a CR re-hydrates the entry from
	// `get_cr_tree`.
	const crSyncState = new Map();

	const treeResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
	});
	const crPageResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_page',
	});

	function getCrState(name) {
		if (!name) return null;
		let state = crSyncState.get(name);
		if (!state) {
			state = { tail: Promise.resolve(), version: null };
			crSyncState.set(name, state);
		}
		return state;
	}

	function recordServerVersion(name, version) {
		if (typeof version !== 'number') return;
		operationVersion.value = version;
		const state = getCrState(name);
		if (state) state.version = version;
	}

	async function fetchTree(name) {
		return treeResource.submit({ name });
	}

	async function fetchPage(name, docKey) {
		return crPageResource.submit({ name, doc_key: docKey });
	}

	// Submit a batch to `apply_cr_operations` and bookkeep the version /
	// conflict state. Returns the response on success and rejects with an
	// Error whose `code === 'version_conflict'` when the server reports
	// the client is behind. Callers do their own local-store merging from
	// `result.temp_key_map`, `result.items`, and `result.deleted_doc_keys`.
	async function applyBatchOps(operations) {
		if (!operations || operations.length === 0) return null;
		const submitCr = crName();
		if (!submitCr) throw new Error('No change request');

		const state = getCrState(submitCr);
		// Chain onto the per-CR tail. Swallowing prior errors prevents
		// one failed batch from poisoning subsequent ones, while each
		// caller still observes its own batch's outcome through its own
		// promise reference.
		const next = state.tail.then(
			() => submitBatch(submitCr, operations),
			() => submitBatch(submitCr, operations),
		);
		state.tail = next.catch(() => {});
		return next;
	}

	async function submitBatch(submitCr, operations) {
		const state = getCrState(submitCr);
		const result = await crStore.applyOperations(
			submitCr,
			state.version,
			operations,
		);

		if (!result) {
			throw new Error('Empty response from apply_cr_operations');
		}
		if (result.ok === false) {
			if (result.error === 'version_conflict') {
				if (typeof result.current_version === 'number') {
					state.version = result.current_version;
					if (crName() === submitCr) {
						operationVersion.value = state.version;
					}
				}
				if (crName() === submitCr) {
					sync.status = 'failed';
					sync.error = result.message || 'This draft has changed elsewhere.';
					sync.conflict = true;
				}
				const err = new Error(
					result.message || 'This draft has changed elsewhere.',
				);
				err.code = 'version_conflict';
				throw err;
			}
			throw new Error(result.message || 'Batch sync failed');
		}

		if (typeof result.current_version === 'number') {
			state.version = result.current_version;
		}
		if (crName() === submitCr) {
			if (typeof result.current_version === 'number') {
				operationVersion.value = result.current_version;
			}
			sync.conflict = false;
		}
		return result;
	}

	function markSaving() {
		sync.status = 'saving';
		sync.error = null;
	}

	function markSaved() {
		sync.status = 'idle';
		sync.lastSavedAt = new Date().toISOString();
		sync.error = null;
	}

	function markFailed(message) {
		sync.status = 'failed';
		sync.error = message;
	}

	function markIdle() {
		sync.status = 'idle';
		sync.error = null;
		sync.conflict = false;
	}

	function reset() {
		operationVersion.value = null;
		sync.status = 'idle';
		sync.lastSavedAt = null;
		sync.error = null;
		sync.conflict = false;
		// crSyncState is intentionally preserved — see comment at declaration.
	}

	return {
		operationVersion,
		sync,
		fetchTree,
		fetchPage,
		applyBatchOps,
		recordServerVersion,
		getCrState,
		markSaving,
		markSaved,
		markFailed,
		markIdle,
		reset,
	};
}
