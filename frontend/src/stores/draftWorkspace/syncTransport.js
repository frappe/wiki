import { createResource } from 'frappe-ui';
import { reactive } from 'vue';

const TREE_ORDER_OPERATIONS = new Set(['move_node', 'reorder_children']);
const CHANGED_ELSEWHERE = 'This draft has changed elsewhere.';

// All backend transport for the workspace: tree/page fetches and the
// batched `apply_cr_operations` endpoint. Owns per-CR sync state
// (tail, last-known structure_version, conflicts) and the `sync` reactive
// that drives the contribution-banner / sync-pill UI.
//
// `crName` is injected as a getter so transport reads the current CR
// at call time (a workspace switch mid-batch must not retarget an
// in-flight call to the new CR).
export function createSyncTransport({ crStore, crName }) {
	const sync = reactive({
		status: 'idle', // 'idle' | 'saving' | 'failed'
		lastSavedAt: null,
		error: null,
		conflict: false,
	});

	// Per-CR sync state: tail (so same-CR batches serialize and never race
	// on their bases), the tree version moves are based on, and the pages and
	// tree that changed elsewhere. Keyed by CR name so
	// a mid-flight workspace switch can't reroute a queued batch to a
	// different CR — each CR has its own tail/conflicts, captured at enqueue
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
			state = {
				tail: Promise.resolve(),
				structureVersion: null,
				conflictPages: new Set(),
				structureConflict: false,
			};
			crSyncState.set(name, state);
		}
		return state;
	}

	function recordServerVersion(name, version) {
		if (typeof version !== 'number') return;
		const state = getCrState(name);
		if (state) state.structureVersion = version;
	}

	function holdBatches(name, promise) {
		const state = getCrState(name);
		state.tail = Promise.all([state.tail, promise]).catch(() => {});
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
		if (state.structureVersion === null) {
			throw versionConflict(submitCr, 'This draft could not be loaded.');
		}
		if (isBlocked(state, operations)) {
			throw versionConflict(submitCr, CHANGED_ELSEWHERE);
		}
		const result = await crStore.applyOperations(
			submitCr,
			operations,
			operations.some((op) => TREE_ORDER_OPERATIONS.has(op.type))
				? state.structureVersion
				: null,
		);

		if (!result) {
			throw new Error('Empty response from apply_cr_operations');
		}
		if (result.ok === false) {
			if (result.error === 'page_conflict') {
				state.conflictPages.add(result.doc_key);
				throw versionConflict(submitCr, result.message || CHANGED_ELSEWHERE);
			}
			if (result.error === 'structure_conflict') {
				state.structureConflict = true;
				throw versionConflict(submitCr, result.message || CHANGED_ELSEWHERE);
			}
			throw new Error(result.message || 'Batch sync failed');
		}

		// Adopt only our own bump: a bigger jump means another tab changed the
		// tree, and a later move must still conflict.
		if (result.structure_version === state.structureVersion + 1) {
			state.structureVersion = result.structure_version;
		}
		if (crName() === submitCr) sync.conflict = hasConflict(state);
		return result;
	}

	function isBlocked(state, operations) {
		return operations.some((op) =>
			op.type === 'update_content'
				? state.conflictPages.has(op.doc_key)
				: state.structureConflict && TREE_ORDER_OPERATIONS.has(op.type),
		);
	}

	function hasConflict(state) {
		return state.conflictPages.size > 0 || state.structureConflict;
	}

	function versionConflict(submitCr, message) {
		showConflict(submitCr, message);
		const err = new Error(message);
		err.code = 'version_conflict';
		return err;
	}

	function showConflict(name, message) {
		if (crName() === name) {
			sync.status = 'failed';
			sync.error = message;
			sync.conflict = true;
		}
	}

	// A conflict blocks saves to that page, or moves in the tree, until
	// `clearConflict`, which only a refetch of the draft may call.
	function flagPageConflict(name, docKey) {
		getCrState(name).conflictPages.add(docKey);
		showConflict(name, CHANGED_ELSEWHERE);
	}

	function clearConflict(name) {
		const state = getCrState(name);
		state.conflictPages.clear();
		state.structureConflict = false;
		if (crName() === name) sync.conflict = false;
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
		sync.status = 'idle';
		sync.lastSavedAt = null;
		sync.error = null;
		sync.conflict = false;
		// crSyncState is intentionally preserved — see comment at declaration.
		// Its conflicts are not: the next hydrate rechecks restored drafts.
		for (const state of crSyncState.values()) {
			state.conflictPages.clear();
			state.structureConflict = false;
		}
	}

	return {
		sync,
		fetchTree,
		fetchPage,
		holdBatches,
		applyBatchOps,
		recordServerVersion,
		getCrState,
		flagPageConflict,
		clearConflict,
		markSaving,
		markSaved,
		markFailed,
		markIdle,
		reset,
	};
}
