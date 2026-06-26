import { useChangeRequestStore } from '@/stores/changeRequest';
import {
	clearDraft as clearPersistedDraft,
	clearDraftsForCr as clearPersistedDraftsForCr,
	loadDraftsForCr,
	saveDraft as savePersistedDraft,
} from '@/stores/draftPersistence';
import { useUserStore } from '@/stores/user';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { createMoveScheduler } from './draftWorkspace/moveScheduler';
import { createOperationQueue } from './draftWorkspace/operationQueue';
import { createPageBuffers } from './draftWorkspace/pageBuffers';
import { createSaveSerializer } from './draftWorkspace/saveSerializer';
import { createSyncTransport } from './draftWorkspace/syncTransport';
import { createTempKeyResolver } from './draftWorkspace/tempKeyResolver';
import {
	createTreeModel,
	denormalizeNode,
	normalizeNode,
} from './draftWorkspace/treeModel';
import { errorMessage, slugify } from './draftWorkspace/utils';

// Local-first workspace store. Owns optimistic UI state for the active change
// request. Sync flushes through the batched `apply_cr_operations` endpoint
// (see specs/local_first_editor_migration_step_2.md). The legacy per-action
// CR RPCs remain wired up under `useBatchOperations = false` for rollout
// safety and will be removed once the batch path is stable in production.
//
// This file is the coordinator: it composes the sub-modules under
// `./draftWorkspace/`, owns the user-facing action surface (createNode,
// updateNode, etc.), and exposes the same public API consumers used
// before the split.

// Toggle to fall back to the Step 1 per-RPC sync path during rollout. Flip to
// false to bypass `apply_cr_operations` and use create_cr_page / update_cr_page
// / move_cr_page / reorder_cr_children / delete_cr_page directly.
const useBatchOperations = true;

export const useDraftWorkspaceStore = defineStore('draftWorkspace', () => {
	const crStore = useChangeRequestStore();
	const userStore = useUserStore();

	const spaceId = ref(null);
	const changesByKey = reactive({});
	const isHydrating = ref(false);
	// False until the first server tree lands (and after reset). Lets the UI
	// show a skeleton instead of mistaking the pre-hydration empty tree for a
	// space with no pages.
	const hasLoadedTree = ref(false);
	let hydratePromise = null;

	const isEnabled = computed(() => userStore.shouldUseChangeRequestMode);
	const crName = computed(() => crStore.currentChangeRequest?.name || null);

	// Sub-modules. Order matters: each may depend on those above it.
	const treeModel = createTreeModel();
	const pageBuffers = createPageBuffers();
	const resolver = createTempKeyResolver();
	const queue = createOperationQueue({ resolveKey: resolver.resolveKey });
	const transport = createSyncTransport({
		crStore,
		crName: () => crName.value,
	});
	const saver = createSaveSerializer();
	const draftPersistTimers = new Map();

	function draftPersistKey(changeRequestName, docKey) {
		return `${changeRequestName}:${docKey}`;
	}

	function cancelDraftPersist(changeRequestName, docKey) {
		const key = draftPersistKey(changeRequestName, docKey);
		const timer = draftPersistTimers.get(key);
		if (timer) clearTimeout(timer);
		draftPersistTimers.delete(key);
	}

	function clearEditorDraft(changeRequestName, docKey) {
		if (!changeRequestName || !docKey) return;
		cancelDraftPersist(changeRequestName, docKey);
		clearPersistedDraft(changeRequestName, docKey);
	}

	// Drop every persisted draft for a change request — used when the CR is
	// discarded or merged so its drafts can't be restored on the next hydrate.
	// Also cancels any pending debounced writes for the CR so an in-flight
	// timer can't re-create an entry right after we clear IndexedDB.
	function discardPersistedDraftsForCr(changeRequestName) {
		if (!changeRequestName) return;
		const prefix = `${changeRequestName}:`;
		for (const key of [...draftPersistTimers.keys()]) {
			if (key.startsWith(prefix)) {
				clearTimeout(draftPersistTimers.get(key));
				draftPersistTimers.delete(key);
			}
		}
		return clearPersistedDraftsForCr(changeRequestName);
	}

	// Keep IndexedDB writes behind the store-owned snapshot. The editor reports
	// content immediately for correct gating; persistence remains lightly
	// debounced so ordinary typing doesn't write on every transaction.
	function persistEditorDraft(docKey, title, { immediate = false } = {}) {
		const changeRequestName = crName.value;
		if (!changeRequestName || !docKey) return;
		const page = pageBuffers.get(docKey);
		if (!page) return;
		const key = draftPersistKey(changeRequestName, docKey);
		cancelDraftPersist(changeRequestName, docKey);
		const persist = () => {
			draftPersistTimers.delete(key);
			if (pageBuffers.isDirty(page)) {
				savePersistedDraft(changeRequestName, docKey, {
					content: page.localContent,
					title: title ?? page.title,
					savedContent: page.content,
				});
			} else {
				clearPersistedDraft(changeRequestName, docKey);
			}
		};
		if (immediate) persist();
		else draftPersistTimers.set(key, setTimeout(persist, 500));
	}

	const finalizationBlocker = computed(() => {
		if (transport.sync.conflict) return 'conflict';
		if (queue.hasFailedMutations.value || transport.sync.status === 'failed') {
			return 'failed';
		}
		if (queue.hasPendingMutations.value || transport.sync.status === 'saving') {
			return 'pending';
		}
		if (pageBuffers.hasUnsavedEditorContent.value) return 'unsaved';
		return null;
	});

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

	const mover = createMoveScheduler({
		resolver,
		queue,
		treeModel,
		transport,
		useBatchOperations,
		crStore,
		crName: () => crName.value,
		scheduleSummaryRefresh,
		errorMessage,
	});

	// Fan-out a tmp_* → real key resolution to every owner that holds
	// state keyed by docKey. Replaces the original
	// `rewriteTempKeyReferences` helper that reached into each map
	// directly.
	resolver.onResolve((tempKey, realKey) => {
		queue.rewriteKeys(tempKey, realKey);
		mover.rewriteKeys(tempKey, realKey);
		saver.rewriteKeys(tempKey, realKey);
	});

	function applyServerTree(serverTree) {
		treeModel.applyServerTree(serverTree);
		hasLoadedTree.value = true;
		if (typeof serverTree?.operation_version === 'number') {
			transport.recordServerVersion(crName.value, serverTree.operation_version);
		}
	}

	function applyChangesSummary(changes) {
		for (const k of Object.keys(changesByKey)) delete changesByKey[k];
		for (const change of changes || []) {
			if (change?.doc_key) changesByKey[change.doc_key] = change;
		}
	}

	function reset() {
		spaceId.value = null;
		hasLoadedTree.value = false;
		treeModel.reset();
		pageBuffers.reset();
		resolver.reset();
		queue.reset();
		mover.reset();
		saver.reset();
		for (const k of Object.keys(changesByKey)) delete changesByKey[k];
		transport.reset();
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
				transport.fetchTree(crName.value),
				crStore.loadChanges(),
			]);

			applyServerTree(serverTree);
			applyChangesSummary(crStore.changes);
			await restorePersistedDrafts();
		})();

		try {
			await hydratePromise;
		} finally {
			isHydrating.value = false;
			hydratePromise = null;
		}
	}

	// Read any drafts persisted to IndexedDB for the current CR and
	// reseed `pagesByKey` with them so the editor opens on the user's
	// last in-progress text. Each restored entry is marked dirty so the
	// banner shows "Unsaved changes" and Submit/merge stay gated until
	// it's saved (or reverted via undo).
	//
	// Entries whose `docKey` no longer corresponds to a real tree node
	// are ignored — they're orphans from deleted pages or from tmp_*
	// creates that never reached the server.
	async function restorePersistedDrafts() {
		if (!crName.value) return;
		const drafts = await loadDraftsForCr(crName.value);
		if (!drafts.length) return;
		await Promise.all(
			drafts.map(async (draft) => {
				const { docKey, content, title } = draft;
				if (!docKey || content == null) return;
				// Only restore for keys that still exist server-side. tmp_*
				// orphans (lost creates) are out of scope for this v1.
				if (resolver.isTempKey(docKey) || !treeModel.findNode(docKey)) return;

				// Verify against the server copy before restoring. A persisted
				// draft that matches the server has no real unsaved changes —
				// it's a redundant/stale entry (e.g. left over from an earlier
				// non-idempotent serialization). Restoring it as dirty would
				// gate Submit/Merge on a phantom "unsaved changes" on every
				// hydrate (and survive an IndexedDB clear once re-persisted), so
				// drop it instead of reseeding dirty state.
				let serverContent = null;
				try {
					const result = await transport.fetchPage(crName.value, docKey);
					serverContent = result?.content ?? '';
				} catch (_err) {
					// Couldn't reach the server — fall through and restore
					// conservatively so we never silently discard real work.
				}
				if (
					content === draft.savedContent ||
					(serverContent != null && content === serverContent)
				) {
					clearEditorDraft(crName.value, docKey);
					return;
				}

				const page = pageBuffers.get(docKey);
				if (!page) {
					pageBuffers.setPage(docKey, {
						docKey,
						title: title || '',
						route: '',
						content: serverContent,
						localContent: content,
						isPublished: true,
						saveStatus: 'idle',
						error: null,
					});
				} else {
					page.localContent = content;
					if (title) page.title = title;
					if (serverContent != null) page.content = serverContent;
					page.saveStatus = 'idle';
					page.error = null;
				}
			}),
		);
	}

	async function reloadTree() {
		if (!crName.value) return;
		const serverTree = await transport.fetchTree(crName.value);
		applyServerTree(serverTree);
	}

	async function reloadChanges() {
		await crStore.loadChanges();
		applyChangesSummary(crStore.changes);
	}

	// "Reload latest" recovery. Adopts server tree + change-summary as
	// truth, discards failed mutations, and refreshes `operation_version`
	// so the next batch sends a non-stale base. Called from the
	// ContributionBanner recovery button after a version conflict or sync
	// failure.
	//
	// We intentionally do NOT clear `page.localContent` here. The open editor's
	// DOM still holds whatever the user typed before the failure; if we
	// unblocked Submit while that content was unsaved, the user could
	// submit a CR that doesn't contain what they see on screen. Leaving
	// the divergent local snapshot keeps Submit gated until the user either saves (which
	// will now succeed because `operation_version` is fresh) or reverts.
	// We do downgrade `saveStatus` from 'failed' → 'idle' so the editor
	// header / sync pill stops asserting a save failure that no longer
	// applies; the underlying content state is what matters.
	async function reloadFromServer() {
		if (!crName.value) return;
		await Promise.all([reloadTree(), reloadChanges()]);
		queue.clearFailed();
		for (const key of Object.keys(pageBuffers.pagesByKey)) {
			pageBuffers.clearFailedFlag(key);
		}
		transport.markIdle();
	}

	// Apply a fetched CR page snapshot to its buffer. A dirty buffer keeps the
	// user's local content and only refreshes the server-confirmed baseline.
	function applyFetchedPage(docKey, result) {
		const localPage = pageBuffers.get(docKey);
		if (pageBuffers.isDirty(localPage)) {
			if (!localPage.title) localPage.title = result?.title || '';
			localPage.route = result?.route || '';
			localPage.content = result?.content || '';
			localPage.isPublished = result?.is_published !== false;
			return localPage;
		}
		return pageBuffers.setPage(docKey, {
			docKey,
			title: result?.title || '',
			route: result?.route || '',
			content: result?.content || '',
			localContent: null,
			isPublished: result?.is_published !== false,
			saveStatus: 'idle',
			error: null,
		});
	}

	// Background revalidation for the stale-while-revalidate path in
	// loadCrPage. De-duplicated per doc key; the fresh snapshot is dropped if
	// the buffer picked up local edits or an in-flight save while we fetched,
	// so we never clobber work the user did in the meantime.
	const pageRevalidations = new Map();
	function revalidateCrPage(docKey) {
		if (pageRevalidations.has(docKey)) return pageRevalidations.get(docKey);
		const requestCr = crName.value;
		const promise = (async () => {
			try {
				const result = await transport.fetchPage(requestCr, docKey);
				// The CR changed (merge/archive reset) or the buffer picked up
				// local edits / an in-flight save while we fetched — drop the
				// snapshot rather than resurrect or clobber state.
				if (crName.value !== requestCr) return;
				const page = pageBuffers.get(docKey);
				if (!page || pageBuffers.isDirty(page) || page.saveStatus !== 'idle') {
					return;
				}
				applyFetchedPage(docKey, result);
			} catch (_err) {
				// Best-effort refresh — the cached buffer stays usable.
			} finally {
				pageRevalidations.delete(docKey);
			}
		})();
		pageRevalidations.set(docKey, promise);
		return promise;
	}

	// Load a single CR page into pagesByKey. Tmp pages live entirely on
	// the client until their create syncs; we never call get_cr_page
	// with a tmp key (the backend would 404).
	async function loadCrPage(docKey) {
		if (!docKey) return null;
		if (resolver.isTempKey(docKey)) {
			return pageBuffers.get(docKey);
		}
		const localPage = pageBuffers.get(docKey);
		if (
			localPage &&
			localPage.content != null &&
			(pageBuffers.isDirty(localPage) ||
				['saving', 'failed'].includes(localPage.saveStatus))
		) {
			return localPage;
		}
		if (!crName.value) return null;
		// Stale-while-revalidate: a clean, already-fetched buffer renders
		// immediately; the server copy refreshes it in the background.
		if (localPage && localPage.content != null) {
			revalidateCrPage(docKey);
			return localPage;
		}
		const result = await transport.fetchPage(crName.value, docKey);
		return applyFetchedPage(docKey, result);
	}

	function updateLocalPageContent(docKey, content, title = null) {
		const realKey = resolver.resolveKey(docKey) || docKey;
		if (!realKey) return null;
		return pageBuffers.updateLocalContent(docKey, realKey, content, title);
	}

	async function ensureCr() {
		if (!isEnabled.value || !spaceId.value) return false;
		if (crName.value) return true;
		await crStore.initChangeRequest(spaceId.value);
		return !!crName.value;
	}

	// Insert node locally with pending_create *before* awaiting anything,
	// then sync in the background. On success swap the temp doc key for
	// the real one. On failure leave the node visible with sync_failed
	// so the user can retry rather than losing their input.
	//
	// Note on single-batch create+content
	// (specs/local_first_editor_migration_step_2.md:540): when `content`
	// is provided up-front (e.g. paste-as-page), it's included in the
	// create_node op and the backend creates + saves in one batch. We
	// deliberately don't defer the create to coalesce with post-create
	// typing — firing immediately keeps the page durable server-side
	// within hundreds of ms; deferring would lose the page on browser
	// refresh during the deferral window. Type-after-create therefore
	// syncs as a second batch (gated by `resolveDocKey` in
	// `doSaveContent`).
	function createNode({
		parentKey,
		title,
		isGroup = false,
		isExternalLink = false,
		externalUrl = null,
		content = '',
		isPublished = true,
	}) {
		const effectiveParent = parentKey || treeModel.rootKey.value || null;
		const tempKey = resolver.makeTempKey();
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
		treeModel.insertNode(localNode, effectiveParent);

		// Seed local page state so opening the row before sync works
		// without a backend roundtrip. Promoted to the real key on success.
		if (!isGroup) {
			pageBuffers.setPage(tempKey, {
				docKey: tempKey,
				title,
				route: slugify(title),
				content,
				isPublished,
				saveStatus: 'idle',
				error: null,
			});
		}

		const mutation = queue.enqueue('create_node', {
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
		resolver.registerCreate(
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
				if (resolver.isTempKey(resolvedParent)) {
					resolvedParent = await resolver.resolveDocKey(resolvedParent);
					if (!resolvedParent) throw new Error('Parent create failed');
				}

				queue.setStatus(mutation.id, 'syncing');

				let realKey = null;
				let route = null;
				let documentName = null;
				if (useBatchOperations) {
					const result = await transport.applyBatchOps([
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
					const node = treeModel.findNode(tempKey);
					if (node) {
						node.docKey = realKey;
						node.serverDocKey = realKey;
						if (route) node.route = route;
						if (documentName) node.documentName = documentName;
						node.localStatus = null;
					}
					pageBuffers.promoteKey(tempKey, realKey, { route });
					// Resolve last so the onResolve listeners (queue / mover
					// / saver rewrites) see the tree + buffers already
					// promoted.
					resolver.resolve(tempKey, realKey);
				}
				queue.clear(mutation.id);
				scheduleSummaryRefresh();
				return realKey || null;
			} catch (err) {
				const node = treeModel.findNode(tempKey);
				if (node) node.localStatus = 'sync_failed';
				queue.setStatus(mutation.id, 'failed', errorMessage(err));
				throw err;
			} finally {
				resolver.finishCreate(tempKey);
			}
		})();
		return createPromise;
	}

	function retryFailedCreate(tempKey) {
		const mutation = queue.findFailedCreate(tempKey);
		if (!mutation) return null;
		mutation.error = null;
		const node = treeModel.findNode(tempKey);
		if (node) node.localStatus = 'pending_create';
		const promise = syncCreateNode(tempKey, mutation);
		resolver.registerCreate(
			tempKey,
			promise.catch(() => null),
		);
		return promise;
	}

	async function updateNode(docKey, fields) {
		const node = treeModel.findNode(docKey);
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

		const page = pageBuffers.get(docKey);
		if (page) {
			if (fields.title !== undefined) page.title = fields.title;
			if (fields.route !== undefined) page.route = fields.route;
			if (fields.is_published !== undefined)
				page.isPublished = !!fields.is_published;
		}

		if (resolver.isTempKey(docKey)) {
			const failedCreate = queue.findFailedCreate(docKey);
			if (failedCreate) {
				if (fields.title !== undefined)
					failedCreate.payload.title = fields.title;
				if (fields.content !== undefined)
					failedCreate.payload.content = fields.content;
				retryFailedCreate(docKey);
			}
		}

		queue.supersedeFailedFor(`update:${docKey}`);
		const mutation = queue.enqueue('update_node', { docKey, fields });
		queue.setStatus(mutation.id, 'syncing');
		try {
			// If this targets a pending temp create, wait for the real key
			// before issuing the backend call.
			const realKey = await resolver.resolveDocKey(docKey);
			if (!realKey) throw new Error('Pending create did not resolve');
			if (!(await ensureCr())) throw new Error('No change request');
			if (useBatchOperations) {
				const result = await transport.applyBatchOps([
					{
						id: mutation.id,
						type: 'update_node',
						doc_key: realKey,
						fields,
					},
				]);
				// Pick up server-recomputed metadata (notably route, when
				// title/slug changed and the caller didn't pin a route).
				const item = (result?.items || []).find((it) => it.doc_key === realKey);
				if (item) {
					const fresh =
						treeModel.findNode(realKey) || treeModel.findNode(docKey);
					if (fresh) {
						if (item.route) fresh.route = item.route;
						if (item.title != null) fresh.title = item.title;
					}
					const buf = pageBuffers.get(realKey) || pageBuffers.get(docKey);
					if (buf) {
						if (item.route) buf.route = item.route;
						if (item.title != null) buf.title = item.title;
					}
				}
			} else {
				await crStore.updatePage(crName.value, realKey, fields);
			}
			const fresh = treeModel.findNode(realKey) || treeModel.findNode(docKey);
			if (fresh) fresh.localStatus = null;
			queue.clear(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const fresh =
				treeModel.findNode(docKey) ||
				treeModel.findNode(resolver.resolveKey(docKey) || '');
			if (fresh) fresh.localStatus = 'sync_failed';
			queue.setStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	async function renameNode(docKey, title) {
		return updateNode(docKey, { title });
	}

	// Apply a drag locally, then queue a debounced backend sync. The
	// legacy view is rebuilt from `tree`, so mutating tree here is what
	// makes the drag persist after vuedraggable's local splice.
	function moveNode({ docKey, newParentKey, newIndex }) {
		const node = treeModel.findNode(docKey);
		if (!node) return;

		const targetParentKey = newParentKey || treeModel.rootKey.value || null;
		const previousParentKey = node.parentKey;

		const sourceList = treeModel.getChildList(previousParentKey);
		if (sourceList) {
			const idx = sourceList.findIndex((n) => n.docKey === docKey);
			if (idx >= 0) sourceList.splice(idx, 1);
		}

		const targetList = treeModel.getChildList(targetParentKey);
		if (!targetList) {
			// Could not find target parent — restore to source.
			if (sourceList) sourceList.push(node);
			return;
		}
		const safeIndex = Math.max(0, Math.min(newIndex, targetList.length));
		targetList.splice(safeIndex, 0, node);
		node.parentKey = targetParentKey;
		node.localStatus = 'pending_update';

		// Coalesce: a rapid second drag of the same item replaces the
		// queued mutation rather than stacking duplicates. Also supersede
		// any prior failed move for this doc — the new local order is
		// now the user's intent and a successful sync should clear the
		// failure.
		queue.dropMatching(
			(m) =>
				m.type === 'move_node' &&
				m.payload?.docKey === docKey &&
				(m.status === 'queued' || m.status === 'failed'),
		);
		queue.enqueue('move_node', { docKey, targetParentKey });
		mover.recordMove(docKey, targetParentKey);
		mover.schedule();
	}

	// Editor content save with success-aware state. `content` advances only
	// after backend success; any newer `localContent` remains divergent.
	function saveContent(docKey, content, title = null) {
		if (!docKey) return Promise.reject(new Error('Missing docKey'));

		// Mark the page as saving immediately so the banner / editor
		// reflect that a save is queued.
		const page = pageBuffers.ensure(docKey, { title: title || '' });
		if (page.localContent == null) pageBuffers.setLocalContent(docKey, content);
		page.saveStatus = 'saving';
		page.error = null;
		transport.markSaving();

		return saver.enqueueSave(docKey, content, title, (c, t) =>
			doSaveContent(docKey, c, t),
		);
	}

	async function doSaveContent(docKey, content, title) {
		const page = pageBuffers.ensure(docKey, {
			title: title || '',
			saveStatus: 'saving',
		});
		page.saveStatus = 'saving';

		const realKey = await resolver.resolveDocKey(docKey);
		if (!realKey) {
			page.saveStatus = 'failed';
			page.error = 'Pending create did not resolve';
			transport.markFailed(page.error);
			throw new Error(page.error);
		}

		queue.supersedeFailedFor(`content:${realKey}`);
		const mutation = queue.enqueue('update_content', { docKey: realKey });
		queue.setStatus(mutation.id, 'syncing');
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
				await transport.applyBatchOps([op]);
			} else {
				const fields = { content };
				if (title != null) fields.title = title;
				await crStore.updatePage(crName.value, realKey, fields);
			}

			const targetPage = pageBuffers.get(realKey) || pageBuffers.get(docKey);
			if (targetPage) {
				targetPage.content = content;
				if (title != null) targetPage.title = title;
				if (targetPage.localContent === content) {
					targetPage.localContent = null;
				}
				targetPage.saveStatus = pageBuffers.isDirty(targetPage)
					? 'idle'
					: 'saved';
				targetPage.error = null;
			}
			// Content is durably on the server now — drop the local IDB
			// backup for both the resolved key and (if different) the
			// pre-promotion tmp key so a future hydrate doesn't restore
			// stale typing on top of fresh server state.
			if (crName.value) {
				persistEditorDraft(realKey, targetPage?.title, { immediate: true });
				if (docKey !== realKey) {
					clearEditorDraft(crName.value, docKey);
				}
			}
			// Only flip global sync to idle if no follow-up save is
			// queued for this doc — otherwise we'd briefly flash 'saved'
			// between chained saves.
			if (!saver.hasQueuedFor(docKey)) {
				transport.markSaved();
			}
			queue.clear(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const targetPage = pageBuffers.get(realKey) || pageBuffers.get(docKey);
			if (targetPage) {
				if (targetPage.localContent == null) targetPage.localContent = content;
				targetPage.saveStatus = 'failed';
				targetPage.error = errorMessage(err);
				persistEditorDraft(realKey, targetPage.title, { immediate: true });
			}
			transport.markFailed(errorMessage(err));
			queue.setStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	// Record the editor's canonical markdown immediately so submit/merge
	// gating observes the same snapshot that will be persisted and saved.
	function recordEditorContent(docKey, content, title, options = {}) {
		if (!docKey) return;
		const realKey = resolver.resolveKey(docKey) || docKey;
		pageBuffers.ensure(realKey, { title: title || '' });
		pageBuffers.setLocalContent(realKey, content);
		persistEditorDraft(realKey, title, {
			immediate: options.persistImmediately,
		});
	}

	// WikiEditor canonicalizes both the visible draft and the confirmed server
	// markdown with its configured parser. Rebasing here prevents harmless
	// markdown round-trip differences from manufacturing dirty state.
	function reconcileEditorContent(docKey, content, savedContent, title) {
		if (!docKey) return;
		const realKey = resolver.resolveKey(docKey) || docKey;
		const page = pageBuffers.reconcileEditorContent(
			realKey,
			content,
			savedContent,
		);
		if (title != null) page.title = title;
		persistEditorDraft(realKey, title, { immediate: true });
	}

	// Mark pending_delete locally (treeAsLegacy hides those). On failure
	// the flag is cleared so the row reappears in the sidebar. For temp
	// nodes whose create never reached the server, just drop the local
	// node and the failed-create mutation rather than calling
	// delete_cr_page with a tmp_* key.
	async function deleteNode(docKey) {
		const node = treeModel.findNode(docKey);
		if (!node) return;
		node.localStatus = 'pending_delete';

		const isTempKey = resolver.isTempKey(docKey);
		queue.supersedeFailedFor(`delete:${docKey}`);
		const mutation = queue.enqueue('delete_node', { docKey });
		queue.setStatus(mutation.id, 'syncing');
		try {
			let resolvedKey = docKey;
			if (isTempKey) {
				resolvedKey = await resolver.resolveDocKey(docKey);
				if (!resolvedKey) {
					// Create never reached the server. Drop everything for
					// this temp key locally so the user doesn't see a
					// stale failure.
					treeModel.removeNodeByKey(docKey);
					pageBuffers.deletePage(docKey);
					queue.dropMatching(
						(m) => m.type === 'create_node' && m.payload?.tempKey === docKey,
					);
					queue.clear(mutation.id);
					return;
				}
			}
			if (!(await ensureCr())) throw new Error('No change request');
			if (useBatchOperations) {
				await transport.applyBatchOps([
					{
						id: mutation.id,
						type: 'delete_node',
						doc_key: resolvedKey,
					},
				]);
			} else {
				await crStore.deletePage(crName.value, resolvedKey);
			}
			queue.clear(mutation.id);
			scheduleSummaryRefresh();
		} catch (err) {
			const fresh = treeModel.findNode(docKey);
			if (fresh) fresh.localStatus = null;
			queue.setStatus(mutation.id, 'failed', errorMessage(err));
			throw err;
		}
	}

	return {
		// state
		spaceId,
		rootKey: treeModel.rootKey,
		tree: treeModel.tree,
		pagesByKey: pageBuffers.pagesByKey,
		changesByKey,
		pending: queue.pending,
		operationVersion: transport.operationVersion,
		sync: transport.sync,
		isHydrating,
		hasLoadedTree,
		tempKeyResolutions: resolver.tempKeyResolutions,
		// getters
		isEnabled,
		crName,
		treeAsLegacy: treeModel.treeAsLegacy,
		hasPendingMutations: queue.hasPendingMutations,
		hasFailedMutations: queue.hasFailedMutations,
		hasUnsavedEditorContent: pageBuffers.hasUnsavedEditorContent,
		finalizationBlocker,
		// actions
		hydrate,
		reloadTree,
		reloadChanges,
		reloadFromServer,
		loadCrPage,
		updateLocalPageContent,
		findNode: treeModel.findNode,
		reset,
		discardPersistedDraftsForCr,
		ensureCr,
		scheduleSummaryRefresh,
		resolveDocKey: resolver.resolveDocKey,
		createNode,
		updateNode,
		renameNode,
		deleteNode,
		moveNode,
		saveContent,
		recordEditorContent,
		reconcileEditorContent,
		// queue helpers (used by upcoming mutation actions)
		enqueueMutation: queue.enqueue,
		setMutationStatus: queue.setStatus,
		clearMutation: queue.clear,
		// internal helpers exposed for tests
		_normalizeNode: normalizeNode,
		_denormalizeNode: denormalizeNode,
		_makeTempKey: resolver.makeTempKey,
	};
});
