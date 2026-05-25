import { useChangeRequestStore } from '@/stores/changeRequest';
import { useUserStore } from '@/stores/user';
import { createResource } from 'frappe-ui';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

// Local-first workspace store. Owns optimistic UI state for the active change
// request. Sync flushes through the batched `apply_cr_operations` endpoint
// (see specs/local_first_editor_migration_step_2.md). The legacy per-action
// CR RPCs remain wired up under `useBatchOperations = false` for rollout
// safety and will be removed once the batch path is stable in production.

// Toggle to fall back to the Step 1 per-RPC sync path during rollout. Flip to
// false to bypass `apply_cr_operations` and use create_cr_page / update_cr_page
// / move_cr_page / reorder_cr_children / delete_cr_page directly.
const useBatchOperations = true;

function makeTempKey() {
	const rand =
		globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
	return `tmp_${rand}`;
}

function makeMutationId() {
	const rand =
		globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
	return `m_${rand}`;
}

function slugify(text) {
	return String(text || '')
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// Normalize a server tree node (snake_case from get_cr_tree) into a DraftNode.
function normalizeNode(serverNode, parentKey = null) {
	const docKey = serverNode.doc_key;
	const children = (serverNode.children || []).map((c) =>
		normalizeNode(c, docKey),
	);
	return {
		docKey,
		serverDocKey: docKey,
		documentName: serverNode.document_name ?? null,
		title: serverNode.title || '',
		route: serverNode.route || '',
		parentKey,
		orderIndex: serverNode.order_index ?? null,
		isGroup: !!serverNode.is_group,
		isPublished: serverNode.is_published !== false,
		isExternalLink: !!serverNode.is_external_link,
		externalUrl: serverNode.external_url || null,
		children,
		localStatus: null,
	};
}

// Convert a DraftNode back to the snake_case shape existing components consume
// (NestedDraggable, WikiDocumentList, etc.). Lets us migrate incrementally.
function denormalizeNode(node) {
	return {
		doc_key: node.docKey,
		document_name: node.documentName,
		title: node.title,
		route: node.route,
		is_group: node.isGroup,
		is_published: node.isPublished,
		is_external_link: node.isExternalLink,
		external_url: node.externalUrl,
		order_index: node.orderIndex,
		children: node.children.map(denormalizeNode),
		local_status: node.localStatus,
	};
}

export const useDraftWorkspaceStore = defineStore('draftWorkspace', () => {
	const crStore = useChangeRequestStore();
	const userStore = useUserStore();

	const spaceId = ref(null);
	const rootKey = ref(null);
	const tree = ref([]);
	const pagesByKey = reactive({});
	const changesByKey = reactive({});
	const pending = ref([]);
	// Last `operation_version` we know the server is on for this CR. Sent as
	// `base_version` on the next batch so the server can detect concurrent
	// edits and reject with a structured conflict instead of clobbering.
	const operationVersion = ref(null);
	const sync = reactive({
		status: 'idle', // 'idle' | 'saving' | 'failed'
		lastSavedAt: null,
		error: null,
		conflict: false,
	});

	const isHydrating = ref(false);
	let hydratePromise = null;

	// Records the realKey assigned to a tmp_* key once the create syncs.
	// Reactive so consumers (e.g. DraftContributionPanel) can swap routes.
	const tempKeyResolutions = reactive({});
	// In-flight create promises keyed by tmp key. Dependent mutations on a
	// pending temp node await the corresponding promise before issuing
	// backend calls (which would otherwise hit the server with a tmp_* key
	// that doesn't exist).
	const createInFlight = new Map();

	const treeResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
	});

	const crPageResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_page',
	});

	const isEnabled = computed(() => userStore.shouldUseChangeRequestMode);
	const crName = computed(() => crStore.currentChangeRequest?.name || null);

	// Filter pending_delete nodes out of the legacy view so deletion feels
	// immediate. They're restored if the backend call fails.
	const treeAsLegacy = computed(() => {
		const filterDeleted = (nodes) =>
			nodes
				.filter((n) => n.localStatus !== 'pending_delete')
				.map((n) => ({
					...denormalizeNode(n),
					children: filterDeleted(n.children),
				}));
		return {
			root_group: rootKey.value,
			children: filterDeleted(tree.value),
		};
	});

	const hasPendingMutations = computed(() =>
		pending.value.some((m) => m.status === 'queued' || m.status === 'syncing'),
	);
	const hasFailedMutations = computed(() =>
		pending.value.some((m) => m.status === 'failed'),
	);

	function reset() {
		spaceId.value = null;
		rootKey.value = null;
		tree.value = [];
		for (const k of Object.keys(pagesByKey)) delete pagesByKey[k];
		for (const k of Object.keys(changesByKey)) delete changesByKey[k];
		for (const k of Object.keys(tempKeyResolutions)) {
			delete tempKeyResolutions[k];
		}
		createInFlight.clear();
		pendingMoves.clear();
		saveTails.clear();
		queuedSaves.clear();
		if (reorderTimer) {
			clearTimeout(reorderTimer);
			reorderTimer = null;
		}
		pending.value = [];
		operationVersion.value = null;
		sync.status = 'idle';
		sync.lastSavedAt = null;
		sync.error = null;
		sync.conflict = false;
	}

	function applyServerTree(serverTree) {
		rootKey.value = serverTree?.root_group || null;
		tree.value = (serverTree?.children || []).map((c) =>
			normalizeNode(c, rootKey.value),
		);
		if (typeof serverTree?.operation_version === 'number') {
			operationVersion.value = serverTree.operation_version;
			// Keep the per-CR map in sync so subsequent batches for this CR
			// use the freshly hydrated version as their base.
			const state = _getCrState(crName.value);
			if (state) state.version = serverTree.operation_version;
		}
	}

	function applyChangesSummary(changes) {
		for (const k of Object.keys(changesByKey)) delete changesByKey[k];
		for (const change of changes || []) {
			if (change?.doc_key) changesByKey[change.doc_key] = change;
		}
	}

	// Hydrate the workspace for a space: ensure CR exists, load tree + summary,
	// and normalize into local state. Idempotent and de-duplicated per call.
	async function hydrate(targetSpaceId) {
		if (!isEnabled.value || !targetSpaceId) return;

		if (hydratePromise && spaceId.value === targetSpaceId) {
			return hydratePromise;
		}

		isHydrating.value = true;
		hydratePromise = (async () => {
			if (spaceId.value !== targetSpaceId) reset();
			spaceId.value = targetSpaceId;

			await crStore.initChangeRequest(targetSpaceId);
			if (!crName.value) return;

			const [serverTree] = await Promise.all([
				treeResource.submit({ name: crName.value }),
				crStore.loadChanges(),
			]);

			applyServerTree(serverTree);
			applyChangesSummary(crStore.changes);
		})();

		try {
			await hydratePromise;
		} finally {
			isHydrating.value = false;
			hydratePromise = null;
		}
	}

	async function reloadTree() {
		if (!crName.value) return;
		const serverTree = await treeResource.submit({ name: crName.value });
		applyServerTree(serverTree);
	}

	async function reloadChanges() {
		await crStore.loadChanges();
		applyChangesSummary(crStore.changes);
	}

	// Load a single CR page into pagesByKey. Tmp pages live entirely on the
	// client until their create syncs; we never call get_cr_page with a tmp
	// key (the backend would 404).
	async function loadCrPage(docKey) {
		if (!docKey) return null;
		if (docKey.startsWith('tmp_')) {
			return pagesByKey[docKey] || null;
		}
		const localPage = pagesByKey[docKey];
		if (
			localPage &&
			(localPage.dirty ||
				['dirty', 'saving', 'failed'].includes(localPage.saveStatus))
		) {
			return localPage;
		}
		if (!crName.value) return null;
		const result = await crPageResource.submit({
			name: crName.value,
			doc_key: docKey,
		});
		pagesByKey[docKey] = {
			docKey,
			title: result?.title || '',
			route: result?.route || '',
			content: result?.content || '',
			isPublished: result?.is_published !== false,
			dirty: false,
			saveStatus: 'idle',
			error: null,
		};
		return pagesByKey[docKey];
	}

	function updateLocalPageContent(docKey, content, title = null) {
		const realKey = tempKeyResolutions[docKey] || docKey;
		if (!realKey) return null;
		let page = pagesByKey[realKey] || pagesByKey[docKey];
		if (!page) {
			page = pagesByKey[realKey] = {
				docKey: realKey,
				title: title || '',
				route: '',
				content: '',
				isPublished: true,
				dirty: false,
				saveStatus: 'idle',
				error: null,
			};
		}
		page.docKey = realKey;
		page.content = content;
		if (title != null) page.title = title;
		page.dirty = true;
		page.saveStatus = 'dirty';
		page.error = null;
		if (realKey !== docKey) {
			pagesByKey[realKey] = page;
			delete pagesByKey[docKey];
		}
		return page;
	}

	function findNode(docKey, nodes = tree.value) {
		for (const node of nodes) {
			if (node.docKey === docKey) return node;
			const found = findNode(docKey, node.children);
			if (found) return found;
		}
		return null;
	}

	// Mutation queue helpers. Subsequent tasks (#3-#5) wire these up.
	function enqueueMutation(type, payload) {
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

	function setMutationStatus(id, status, error = null) {
		const mutation = pending.value.find((m) => m.id === id);
		if (!mutation) return;
		mutation.status = status;
		mutation.error = error;
	}

	function clearMutation(id) {
		pending.value = pending.value.filter((m) => m.id !== id);
	}

	// Identifies the (logical) target a mutation operates on. A new mutation
	// for the same target supersedes prior failed mutations against it — so
	// a successful retry doesn't leave the workspace stuck behind a stale
	// failure that hasFailedMutations / submit-merge gating reacts to.
	//
	// Resolves tmp_* keys to their real key when comparing — a mutation
	// enqueued before a create resolved still carries the tmp key in its
	// payload, but logically targets the same node as later mutations
	// against the real key.
	function supersessionKey(mutation) {
		if (!mutation) return null;
		const { type, payload } = mutation;
		const resolve = (k) => (k && tempKeyResolutions[k]) || k;
		if (type === 'create_node') return `create:${payload?.tempKey}`;
		if (type === 'update_node') return `update:${resolve(payload?.docKey)}`;
		if (type === 'delete_node') return `delete:${resolve(payload?.docKey)}`;
		if (type === 'move_node') return `move:${resolve(payload?.docKey)}`;
		if (type === 'update_content') return `content:${resolve(payload?.docKey)}`;
		return null;
	}

	function supersedeFailedMutationsFor(key) {
		if (!key) return;
		pending.value = pending.value.filter(
			(m) => !(m.status === 'failed' && supersessionKey(m) === key),
		);
	}

	// Rewrite docKey references from a tmp_* key to its real key across
	// queues whose lookups happen by raw payload value (coalesce filters,
	// pendingMoves, save chains). Without this a stale tmp-keyed entry
	// would never coalesce with future real-keyed activity, and stale
	// failed mutations under the tmp key wouldn't be reachable for
	// supersession by their target's natural key.
	function rewriteTempKeyReferences(tempKey, realKey) {
		if (!tempKey || !realKey || tempKey === realKey) return;

		for (const m of pending.value) {
			const p = m.payload;
			if (!p) continue;
			if (p.docKey === tempKey) p.docKey = realKey;
			if (p.targetParentKey === tempKey) p.targetParentKey = realKey;
			if (p.parentKey === tempKey) p.parentKey = realKey;
		}

		if (pendingMoves.has(tempKey)) {
			pendingMoves.set(realKey, pendingMoves.get(tempKey));
			pendingMoves.delete(tempKey);
		}
		for (const v of pendingMoves.values()) {
			if (v.targetParentKey === tempKey) v.targetParentKey = realKey;
		}

		if (saveTails.has(tempKey)) {
			saveTails.set(realKey, saveTails.get(tempKey));
			saveTails.delete(tempKey);
		}
		if (queuedSaves.has(tempKey)) {
			queuedSaves.set(realKey, queuedSaves.get(tempKey));
			queuedSaves.delete(tempKey);
		}
	}

	async function ensureCr() {
		if (!isEnabled.value || !spaceId.value) return false;
		if (crName.value) return true;
		await crStore.initChangeRequest(spaceId.value);
		return !!crName.value;
	}

	let summaryRefreshTimer = null;
	function scheduleSummaryRefresh(delay = 1000) {
		if (summaryRefreshTimer) clearTimeout(summaryRefreshTimer);
		summaryRefreshTimer = setTimeout(async () => {
			summaryRefreshTimer = null;
			try {
				await reloadChanges();
			} catch (_err) {
				// Summary refresh is best-effort; durable state lives in the store.
			}
		}, delay);
	}

	function getChildList(parentKey) {
		if (!parentKey || parentKey === rootKey.value) return tree.value;
		return findNode(parentKey)?.children || null;
	}

	function insertNode(node, parentKey) {
		const list = getChildList(parentKey);
		if (list) list.push(node);
	}

	function removeNodeByKey(docKey) {
		const removeFrom = (list) => {
			const idx = list.findIndex((n) => n.docKey === docKey);
			if (idx >= 0) return list.splice(idx, 1)[0];
			for (const n of list) {
				const found = removeFrom(n.children);
				if (found) return found;
			}
			return null;
		};
		return removeFrom(tree.value);
	}

	function errorMessage(err) {
		return err?.messages?.[0] || err?.message || String(err);
	}

	// Resolve a docKey to its real server key. Plain keys pass through;
	// tmp_* keys await their in-flight create, then return the realKey (or
	// null if the create failed or was never issued).
	async function resolveDocKey(docKey) {
		if (!docKey || !docKey.startsWith('tmp_')) return docKey;
		if (tempKeyResolutions[docKey]) return tempKeyResolutions[docKey];
		const inFlight = createInFlight.get(docKey);
		if (!inFlight) return null;
		try {
			return (await inFlight) || null;
		} catch (_err) {
			return null;
		}
	}

	// Per-CR sync state: tail (so same-CR batches serialize and never race
	// on base_version) and the latest known version. Keyed by CR name so a
	// mid-flight workspace switch can't reroute a queued batch to a
	// different CR — each CR has its own tail/version, captured at enqueue
	// time. The map is intentionally not cleared on `reset()`: pending
	// batches for an abandoned CR still need to resolve against their
	// captured CR, and re-entering a CR re-hydrates the entry from
	// `get_cr_tree`.
	const crSyncState = new Map();

	function _getCrState(name) {
		if (!name) return null;
		let state = crSyncState.get(name);
		if (!state) {
			state = { tail: Promise.resolve(), version: null };
			crSyncState.set(name, state);
		}
		return state;
	}

	// Submit a batch to `apply_cr_operations` and bookkeep the version /
	// conflict state. Returns the response on success and rejects with an
	// Error whose `code === 'version_conflict'` when the server reports the
	// client is behind. Callers do their own local-store merging from
	// `result.temp_key_map`, `result.items`, and `result.deleted_doc_keys`.
	async function applyBatchOps(operations) {
		if (!operations || operations.length === 0) return null;
		if (!(await ensureCr())) throw new Error('No change request');

		// Pin the CR identity at enqueue so a mid-flight space switch can't
		// reroute this batch to a different CR.
		const submitCr = crName.value;
		const state = _getCrState(submitCr);

		// Chain onto the per-CR tail. Swallowing prior errors prevents one
		// failed batch from poisoning subsequent ones, while each caller
		// still observes its own batch's outcome through its own promise
		// reference.
		const next = state.tail.then(
			() => _submitBatch(submitCr, operations),
			() => _submitBatch(submitCr, operations),
		);
		state.tail = next.catch(() => {});
		return next;
	}

	async function _submitBatch(submitCr, operations) {
		const state = _getCrState(submitCr);
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
					if (crName.value === submitCr) {
						operationVersion.value = state.version;
					}
				}
				if (crName.value === submitCr) {
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
		if (crName.value === submitCr) {
			if (typeof result.current_version === 'number') {
				operationVersion.value = result.current_version;
			}
			sync.conflict = false;
		}
		return result;
	}

	// Insert node locally with pending_create *before* awaiting anything,
	// then sync in the background. On success swap the temp doc key for the
	// real one. On failure leave the node visible with sync_failed so the
	// user can retry rather than losing their input.
	function createNode({
		parentKey,
		title,
		isGroup = false,
		isExternalLink = false,
		externalUrl = null,
		content = '',
		isPublished = true,
	}) {
		const effectiveParent = parentKey || rootKey.value || null;
		const tempKey = makeTempKey();
		const localNode = {
			docKey: tempKey,
			serverDocKey: null,
			documentName: null,
			title,
			route: slugify(title),
			parentKey: effectiveParent,
			orderIndex: null,
			isGroup,
			isPublished,
			isExternalLink,
			externalUrl,
			children: [],
			localStatus: 'pending_create',
		};
		insertNode(localNode, effectiveParent);

		// Seed local page state so opening the row before sync works without
		// a backend roundtrip. Promoted to the real key on success.
		if (!isGroup) {
			pagesByKey[tempKey] = {
				docKey: tempKey,
				title,
				route: slugify(title),
				content,
				isPublished,
				dirty: false,
				saveStatus: 'idle',
				error: null,
			};
		}

		const mutation = enqueueMutation('create_node', {
			tempKey,
			parentKey: effectiveParent,
			title,
			isGroup,
			isExternalLink,
			externalUrl,
			content,
		});

		const createPromise = syncCreateNode(tempKey, mutation);

		// Swallow rejection on the stored promise so dependent awaiters
		// (resolveDocKey) don't trigger unhandled-rejection warnings; we
		// surface the error through mutation status instead.
		createInFlight.set(
			tempKey,
			createPromise.catch(() => null),
		);
		return { tempKey, promise: createPromise };
	}

	function syncCreateNode(tempKey, mutation) {
		const payload = mutation.payload;
		const createPromise = (async () => {
			try {
				if (!(await ensureCr())) throw new Error('No change request');

				// If parent is itself a pending temp create, wait for it.
				let resolvedParent = payload.parentKey;
				if (resolvedParent?.startsWith('tmp_')) {
					resolvedParent = await resolveDocKey(resolvedParent);
					if (!resolvedParent) throw new Error('Parent create failed');
				}

				setMutationStatus(mutation.id, 'syncing');

				let realKey = null;
				let route = null;
				let documentName = null;
				if (useBatchOperations) {
					const result = await applyBatchOps([
						{
							id: mutation.id,
							type: 'create_node',
							temp_key: tempKey,
							parent_key: resolvedParent,
							title: payload.title,
							content: payload.content || '',
							is_group: !!payload.isGroup,
							is_external_link: !!payload.isExternalLink,
							external_url: payload.externalUrl ?? null,
						},
					]);
					realKey = result?.temp_key_map?.[tempKey] || null;
					if (realKey) {
						const item = (result.items || []).find(
							(it) => it.doc_key === realKey,
						);
						route = item?.route || null;
						documentName = item?.document_name || null;
					}
				} else {
					const result = await crStore.createPage(
						crName.value,
						resolvedParent,
						payload.title,
						payload.content,
						payload.isGroup,
						payload.isExternalLink,
						payload.externalUrl,
					);
					realKey = typeof result === 'string' ? result : result?.doc_key;
					route = result?.route || null;
				}

				if (realKey) {
					const node = findNode(tempKey);
					if (node) {
						node.docKey = realKey;
						node.serverDocKey = realKey;
						if (route) node.route = route;
						if (documentName) node.documentName = documentName;
						node.localStatus = null;
					}
					if (pagesByKey[tempKey]) {
						pagesByKey[realKey] = {
							...pagesByKey[tempKey],
							docKey: realKey,
							route: route ?? pagesByKey[tempKey].route,
						};
						delete pagesByKey[tempKey];
					}
					tempKeyResolutions[tempKey] = realKey;
					rewriteTempKeyReferences(tempKey, realKey);
				}
				clearMutation(mutation.id);
				scheduleSummaryRefresh();
				return realKey || null;
			} catch (err) {
				const node = findNode(tempKey);
				if (node) node.localStatus = 'sync_failed';
				setMutationStatus(mutation.id, 'failed', errorMessage(err));
				throw err;
			} finally {
				createInFlight.delete(tempKey);
			}
		})();
		return createPromise;
	}

	function retryFailedCreate(tempKey) {
		const mutation = pending.value.find(
			(m) =>
				m.type === 'create_node' &&
				m.payload?.tempKey === tempKey &&
				m.status === 'failed',
		);
		if (!mutation) return null;
		mutation.error = null;
		const node = findNode(tempKey);
		if (node) node.localStatus = 'pending_create';
		const promise = syncCreateNode(tempKey, mutation);
		createInFlight.set(
			tempKey,
			promise.catch(() => null),
		);
		return promise;
	}

	async function updateNode(docKey, fields) {
		const node = findNode(docKey);
		if (!node) return;

		// Apply locally first so the UI reflects the change immediately.
		if (fields.title !== undefined) node.title = fields.title;
		if (fields.route !== undefined) node.route = fields.route;
		if (fields.is_published !== undefined)
			node.isPublished = !!fields.is_published;
		if (fields.is_external_link !== undefined)
			node.isExternalLink = !!fields.is_external_link;
		if (fields.external_url !== undefined)
			node.externalUrl = fields.external_url;
		node.localStatus = 'pending_update';

		const page = pagesByKey[docKey];
		if (page) {
			if (fields.title !== undefined) page.title = fields.title;
			if (fields.route !== undefined) page.route = fields.route;
			if (fields.is_published !== undefined)
				page.isPublished = !!fields.is_published;
		}

		if (docKey.startsWith('tmp_')) {
			const failedCreate = pending.value.find(
				(m) =>
					m.type === 'create_node' &&
					m.payload?.tempKey === docKey &&
					m.status === 'failed',
			);
			if (failedCreate) {
				if (fields.title !== undefined)
					failedCreate.payload.title = fields.title;
				if (fields.content !== undefined)
					failedCreate.payload.content = fields.content;
				retryFailedCreate(docKey);
			}
		}

		supersedeFailedMutationsFor(`update:${docKey}`);
		const mutation = enqueueMutation('update_node', { docKey, fields });
		setMutationStatus(mutation.id, 'syncing');
		try {
			// If this targets a pending temp create, wait for the real key
			// before issuing the backend call.
			const realKey = await resolveDocKey(docKey);
			if (!realKey) throw new Error('Pending create did not resolve');
			if (!(await ensureCr())) throw new Error('No change request');
			if (useBatchOperations) {
				const result = await applyBatchOps([
					{
						id: mutation.id,
						type: 'update_node',
						doc_key: realKey,
						fields,
					},
				]);
				// Pick up server-recomputed metadata (notably route, when title/slug
				// changed and the caller didn't pin a route).
				const item = (result?.items || []).find((it) => it.doc_key === realKey);
				if (item) {
					const fresh = findNode(realKey) || findNode(docKey);
					if (fresh) {
						if (item.route) fresh.route = item.route;
						if (item.title != null) fresh.title = item.title;
					}
					const page = pagesByKey[realKey] || pagesByKey[docKey];
					if (page) {
						if (item.route) page.route = item.route;
						if (item.title != null) page.title = item.title;
					}
				}
			} else {
				await crStore.updatePage(crName.value, realKey, fields);
			}
			const fresh = findNode(realKey) || findNode(docKey);
			if (fresh) fresh.localStatus = null;
			clearMutation(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const fresh =
				findNode(docKey) || findNode(tempKeyResolutions[docKey] || '');
			if (fresh) fresh.localStatus = 'sync_failed';
			setMutationStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	async function renameNode(docKey, title) {
		return updateNode(docKey, { title });
	}

	// Tracks the latest target per docKey so rapid drags collapse into one
	// backend roundtrip when the debounce fires. Non-reactive.
	const pendingMoves = new Map();
	let reorderTimer = null;
	let reorderInFlight = false;

	function scheduleReorderSync(delay = 750) {
		if (reorderTimer) clearTimeout(reorderTimer);
		reorderTimer = setTimeout(() => {
			reorderTimer = null;
			flushReorderSync();
		}, delay);
	}

	// Apply a drag locally, then queue a debounced backend sync. The legacy
	// view is rebuilt from `tree`, so mutating tree here is what makes the
	// drag persist after vuedraggable's local splice.
	function moveNode({ docKey, newParentKey, newIndex }) {
		const node = findNode(docKey);
		if (!node) return;

		const targetParentKey = newParentKey || rootKey.value || null;
		const previousParentKey = node.parentKey;

		const sourceList = getChildList(previousParentKey);
		if (sourceList) {
			const idx = sourceList.findIndex((n) => n.docKey === docKey);
			if (idx >= 0) sourceList.splice(idx, 1);
		}

		const targetList = getChildList(targetParentKey);
		if (!targetList) {
			// Could not find target parent — restore to source.
			if (sourceList) sourceList.push(node);
			return;
		}
		const safeIndex = Math.max(0, Math.min(newIndex, targetList.length));
		targetList.splice(safeIndex, 0, node);
		node.parentKey = targetParentKey;
		node.localStatus = 'pending_update';

		// Coalesce: a rapid second drag of the same item replaces the queued
		// mutation rather than stacking duplicates. Also supersede any
		// prior failed move for this doc — the new local order is now the
		// user's intent and a successful sync should clear the failure.
		pending.value = pending.value.filter(
			(m) =>
				!(
					m.type === 'move_node' &&
					m.payload?.docKey === docKey &&
					(m.status === 'queued' || m.status === 'failed')
				),
		);
		enqueueMutation('move_node', { docKey, targetParentKey });
		pendingMoves.set(docKey, { targetParentKey });
		scheduleReorderSync();
	}

	async function flushReorderSync() {
		if (reorderInFlight) return;
		if (pendingMoves.size === 0) return;
		if (!(await ensureCr())) return;

		reorderInFlight = true;
		const snapshot = Array.from(pendingMoves.entries());
		pendingMoves.clear();

		const moveMutations = pending.value.filter(
			(m) =>
				m.type === 'move_node' &&
				snapshot.some(([k]) => k === m.payload?.docKey),
		);
		for (const m of moveMutations) setMutationStatus(m.id, 'syncing');

		const failedKeys = [];
		try {
			if (useBatchOperations) {
				// Pack every drag (and its parent's full sibling order) into a
				// single atomic batch so the backend sees one user intent
				// rather than a chain of move/reorder pairs.
				const ops = [];
				const reorderedParents = new Set();
				for (const [docKey, { targetParentKey }] of snapshot) {
					const realKey = await resolveDocKey(docKey);
					const realParentKey = await resolveDocKey(targetParentKey);
					if (!realKey || !realParentKey) {
						failedKeys.push(docKey);
						continue;
					}
					const node = findNode(realKey) || findNode(docKey);
					const parentList = node ? getChildList(node.parentKey) : null;
					const newIndex = parentList
						? parentList.findIndex(
								(n) => n.docKey === realKey || n.docKey === docKey,
						  )
						: 0;
					const muId =
						moveMutations.find((m) => m.payload?.docKey === docKey)?.id ||
						docKey;
					ops.push({
						id: `${muId}-move`,
						type: 'move_node',
						doc_key: realKey,
						target_parent_key: realParentKey,
						order_index: Math.max(0, newIndex),
					});
					if (!reorderedParents.has(realParentKey)) {
						reorderedParents.add(realParentKey);
						const siblingKeys = parentList
							? await Promise.all(
									parentList.map((n) => resolveDocKey(n.docKey)),
							  )
							: [];
						const filteredSiblings = siblingKeys.filter(Boolean);
						if (filteredSiblings.length) {
							ops.push({
								id: `${realParentKey}-reorder`,
								type: 'reorder_children',
								parent_key: realParentKey,
								ordered_doc_keys: filteredSiblings,
							});
						}
					}
				}
				if (ops.length) await applyBatchOps(ops);
				for (const [docKey] of snapshot) {
					if (failedKeys.includes(docKey)) continue;
					const realKey = tempKeyResolutions[docKey] || docKey;
					const fresh = findNode(realKey) || findNode(docKey);
					if (fresh) fresh.localStatus = null;
				}
			} else {
				for (const [docKey, { targetParentKey }] of snapshot) {
					const realKey = await resolveDocKey(docKey);
					const realParentKey = await resolveDocKey(targetParentKey);
					if (!realKey || !realParentKey) {
						failedKeys.push(docKey);
						continue;
					}

					const node = findNode(realKey) || findNode(docKey);
					const parentList = node ? getChildList(node.parentKey) : null;
					const newIndex = parentList
						? parentList.findIndex(
								(n) => n.docKey === realKey || n.docKey === docKey,
						  )
						: 0;

					await crStore.movePage(
						crName.value,
						realKey,
						realParentKey,
						Math.max(0, newIndex),
					);

					// Send the parent's full sibling order so the backend matches
					// what the user sees — resolving any temp siblings first.
					const siblingKeys = parentList
						? await Promise.all(parentList.map((n) => resolveDocKey(n.docKey)))
						: [];
					const filteredSiblings = siblingKeys.filter(Boolean);
					if (filteredSiblings.length) {
						await crStore.reorderChildren(
							crName.value,
							realParentKey,
							filteredSiblings,
						);
					}

					const fresh = findNode(realKey) || findNode(docKey);
					if (fresh) fresh.localStatus = null;
				}
			}
			for (const m of moveMutations) {
				if (failedKeys.includes(m.payload?.docKey)) {
					setMutationStatus(m.id, 'failed', 'Pending create did not resolve');
				} else {
					clearMutation(m.id);
				}
			}
			scheduleSummaryRefresh();
		} catch (err) {
			for (const m of moveMutations) {
				setMutationStatus(m.id, 'failed', errorMessage(err));
			}
			// Reconcile from server so the user sees what the backend ended up with.
			try {
				await reloadTree();
			} catch (_reloadErr) {
				// Reload failed; the failed-mutation status remains visible to
				// the user with the original error.
			}
		} finally {
			reorderInFlight = false;
			if (pendingMoves.size > 0) scheduleReorderSync(0);
		}
	}

	// Editor content save with success-aware state. The page's saveStatus
	// flows dirty -> saving -> saved | failed; the editor only marks itself
	// clean when the new savedContent prop matches its current markdown.
	//
	// Saves are serialized per-doc: while one is in flight, subsequent
	// calls collapse to the latest content and run after. This avoids
	// older requests landing after newer ones and overwriting backend
	// content (the frontend can't observe HTTP write order, so we
	// guarantee ordering by not racing).
	const saveTails = new Map(); // docKey -> Promise (current chain tail)
	const queuedSaves = new Map(); // docKey -> { content, title }

	function saveContent(docKey, content, title = null) {
		if (!docKey) return Promise.reject(new Error('Missing docKey'));

		// Always overwrite any queued save so we only ever run with the
		// latest content. Mark the page as saving immediately so the
		// banner / editor reflect that a save is queued.
		queuedSaves.set(docKey, { content, title });
		const page = pagesByKey[docKey];
		if (page) {
			page.saveStatus = 'saving';
			page.error = null;
		}
		sync.status = 'saving';
		sync.error = null;

		const tail = saveTails.get(docKey) || Promise.resolve();
		const next = tail
			.catch(() => {})
			.then(async () => {
				const params = queuedSaves.get(docKey);
				if (!params) return; // collapsed by a later call that already ran
				queuedSaves.delete(docKey);
				return _doSaveContent(docKey, params.content, params.title);
			});
		saveTails.set(docKey, next);
		next.finally(() => {
			if (saveTails.get(docKey) === next) saveTails.delete(docKey);
		});
		return next;
	}

	async function _doSaveContent(docKey, content, title) {
		let page = pagesByKey[docKey];
		if (!page) {
			page = pagesByKey[docKey] = {
				docKey,
				title: title || '',
				route: '',
				content: '',
				isPublished: true,
				dirty: true,
				saveStatus: 'saving',
				error: null,
			};
		}

		const realKey = await resolveDocKey(docKey);
		if (!realKey) {
			page.saveStatus = 'failed';
			page.error = 'Pending create did not resolve';
			sync.status = 'failed';
			sync.error = page.error;
			throw new Error(page.error);
		}

		supersedeFailedMutationsFor(`content:${realKey}`);
		const mutation = enqueueMutation('update_content', { docKey: realKey });
		setMutationStatus(mutation.id, 'syncing');
		try {
			if (!(await ensureCr())) throw new Error('No change request');
			if (useBatchOperations) {
				const op = {
					id: mutation.id,
					type: 'update_content',
					doc_key: realKey,
					content,
				};
				if (title != null) op.title = title;
				await applyBatchOps([op]);
			} else {
				const fields = { content };
				if (title != null) fields.title = title;
				await crStore.updatePage(crName.value, realKey, fields);
			}

			const targetPage = pagesByKey[realKey] || pagesByKey[docKey];
			if (targetPage) {
				targetPage.content = content;
				if (title != null) targetPage.title = title;
				targetPage.dirty = false;
				targetPage.saveStatus = 'saved';
				targetPage.error = null;
			}
			// Only flip global sync to idle if no follow-up save is queued
			// for this doc — otherwise we'd briefly flash 'saved' between
			// chained saves.
			if (!queuedSaves.has(docKey)) {
				sync.status = 'idle';
				sync.lastSavedAt = new Date().toISOString();
				sync.error = null;
			}
			clearMutation(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const targetPage = pagesByKey[realKey] || pagesByKey[docKey];
			if (targetPage) {
				targetPage.dirty = true;
				targetPage.saveStatus = 'failed';
				targetPage.error = errorMessage(err);
			}
			sync.status = 'failed';
			sync.error = errorMessage(err);
			setMutationStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	function markPageDirty(docKey) {
		const page = pagesByKey[docKey];
		if (!page) return;
		if (page.saveStatus === 'saving') return;
		page.dirty = true;
		page.saveStatus = 'dirty';
	}

	// Mark pending_delete locally (treeAsLegacy hides those). On failure the
	// flag is cleared so the row reappears in the sidebar. For temp nodes
	// whose create never reached the server, just drop the local node and
	// the failed-create mutation rather than calling delete_cr_page with a
	// tmp_* key.
	async function deleteNode(docKey) {
		const node = findNode(docKey);
		if (!node) return;
		node.localStatus = 'pending_delete';

		const isTempKey = docKey.startsWith('tmp_');
		supersedeFailedMutationsFor(`delete:${docKey}`);
		const mutation = enqueueMutation('delete_node', { docKey });
		setMutationStatus(mutation.id, 'syncing');
		try {
			let resolvedKey = docKey;
			if (isTempKey) {
				resolvedKey = await resolveDocKey(docKey);
				if (!resolvedKey) {
					// Create never reached the server. Drop everything for this
					// temp key locally so the user doesn't see a stale failure.
					removeNodeByKey(docKey);
					delete pagesByKey[docKey];
					pending.value = pending.value.filter(
						(m) => !(m.type === 'create_node' && m.payload?.tempKey === docKey),
					);
					clearMutation(mutation.id);
					return;
				}
			}
			if (!(await ensureCr())) throw new Error('No change request');
			if (useBatchOperations) {
				await applyBatchOps([
					{
						id: mutation.id,
						type: 'delete_node',
						doc_key: resolvedKey,
					},
				]);
			} else {
				await crStore.deletePage(crName.value, resolvedKey);
			}
			clearMutation(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const fresh = findNode(docKey);
			if (fresh) fresh.localStatus = null;
			setMutationStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	return {
		// state
		spaceId,
		rootKey,
		tree,
		pagesByKey,
		changesByKey,
		pending,
		operationVersion,
		sync,
		isHydrating,
		tempKeyResolutions,
		// getters
		isEnabled,
		crName,
		treeAsLegacy,
		hasPendingMutations,
		hasFailedMutations,
		// actions
		hydrate,
		reloadTree,
		reloadChanges,
		loadCrPage,
		updateLocalPageContent,
		findNode,
		reset,
		ensureCr,
		scheduleSummaryRefresh,
		resolveDocKey,
		createNode,
		updateNode,
		renameNode,
		deleteNode,
		moveNode,
		saveContent,
		markPageDirty,
		// queue helpers (used by upcoming mutation actions)
		enqueueMutation,
		setMutationStatus,
		clearMutation,
		// internal helpers exposed for tests
		_normalizeNode: normalizeNode,
		_denormalizeNode: denormalizeNode,
		_makeTempKey: makeTempKey,
	};
});
