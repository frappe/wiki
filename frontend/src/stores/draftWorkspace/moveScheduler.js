// Debounced drag/reorder scheduler. Coalesces rapid drags into a single
// batched backend call (one move op per dragged node + one reorder op per
// touched parent) so vuedraggable's per-event noise doesn't translate to
// N round-trips.
//
// The legacy fall-back path (when `useBatchOperations` is false) issues
// per-node move + per-parent reorder RPCs directly. Will go away once the
// batch path is stable in production.
export function createMoveScheduler({
	resolver,
	queue,
	treeModel,
	transport,
	useBatchOperations,
	crStore,
	crName,
	scheduleSummaryRefresh,
	errorMessage,
}) {
	// Tracks the latest target per docKey so rapid drags collapse into
	// one backend roundtrip when the debounce fires. Non-reactive.
	const pendingMoves = new Map();
	let reorderTimer = null;
	let reorderInFlight = false;

	function schedule(delay = 750) {
		if (reorderTimer) clearTimeout(reorderTimer);
		reorderTimer = setTimeout(() => {
			reorderTimer = null;
			flush();
		}, delay);
	}

	function recordMove(docKey, targetParentKey) {
		pendingMoves.set(docKey, { targetParentKey });
	}

	async function flush() {
		if (reorderInFlight) return;
		if (pendingMoves.size === 0) return;
		if (!crName()) return;

		reorderInFlight = true;
		const snapshot = Array.from(pendingMoves.entries());
		pendingMoves.clear();

		const moveMutations = queue.pending.value.filter(
			(m) =>
				m.type === 'move_node' &&
				snapshot.some(([k]) => k === m.payload?.docKey),
		);
		for (const m of moveMutations) queue.setStatus(m.id, 'syncing');

		const failedKeys = [];
		try {
			if (useBatchOperations) {
				// Pack every drag (and its parent's full sibling order)
				// into a single atomic batch so the backend sees one
				// user intent rather than a chain of move/reorder pairs.
				const ops = [];
				const reorderedParents = new Set();
				for (const [docKey, { targetParentKey }] of snapshot) {
					const realKey = await resolver.resolveDocKey(docKey);
					const realParentKey = await resolver.resolveDocKey(targetParentKey);
					if (!realKey || !realParentKey) {
						failedKeys.push(docKey);
						continue;
					}
					const node =
						treeModel.findNode(realKey) || treeModel.findNode(docKey);
					const parentList = node
						? treeModel.getChildList(node.parentKey)
						: null;
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
									parentList.map((n) => resolver.resolveDocKey(n.docKey)),
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
				if (ops.length) await transport.applyBatchOps(ops);
				for (const [docKey] of snapshot) {
					if (failedKeys.includes(docKey)) continue;
					const realKey = resolver.resolveKey(docKey) || docKey;
					const fresh =
						treeModel.findNode(realKey) || treeModel.findNode(docKey);
					if (fresh) fresh.localStatus = null;
				}
			} else {
				for (const [docKey, { targetParentKey }] of snapshot) {
					const realKey = await resolver.resolveDocKey(docKey);
					const realParentKey = await resolver.resolveDocKey(targetParentKey);
					if (!realKey || !realParentKey) {
						failedKeys.push(docKey);
						continue;
					}

					const node =
						treeModel.findNode(realKey) || treeModel.findNode(docKey);
					const parentList = node
						? treeModel.getChildList(node.parentKey)
						: null;
					const newIndex = parentList
						? parentList.findIndex(
								(n) => n.docKey === realKey || n.docKey === docKey,
						  )
						: 0;

					await crStore.movePage(
						crName(),
						realKey,
						realParentKey,
						Math.max(0, newIndex),
					);

					// Send the parent's full sibling order so the backend
					// matches what the user sees — resolving any temp
					// siblings first.
					const siblingKeys = parentList
						? await Promise.all(
								parentList.map((n) => resolver.resolveDocKey(n.docKey)),
						  )
						: [];
					const filteredSiblings = siblingKeys.filter(Boolean);
					if (filteredSiblings.length) {
						await crStore.reorderChildren(
							crName(),
							realParentKey,
							filteredSiblings,
						);
					}

					const fresh =
						treeModel.findNode(realKey) || treeModel.findNode(docKey);
					if (fresh) fresh.localStatus = null;
				}
			}
			for (const m of moveMutations) {
				if (failedKeys.includes(m.payload?.docKey)) {
					queue.setStatus(m.id, 'failed', 'Pending create did not resolve');
				} else {
					queue.clear(m.id);
				}
			}
			scheduleSummaryRefresh();
		} catch (err) {
			for (const m of moveMutations) {
				queue.setStatus(m.id, 'failed', errorMessage(err));
			}
			// Keep the user's optimistic order visible — failing AND
			// snapping the tree back to server state discards their drag
			// intent twice. The failed mutation is visible in the sync
			// pill, and `Reload latest` in ContributionBanner is the
			// explicit recovery.
		} finally {
			reorderInFlight = false;
			if (pendingMoves.size > 0) schedule(0);
		}
	}

	function rewriteKeys(oldKey, newKey) {
		if (!oldKey || !newKey || oldKey === newKey) return;
		if (pendingMoves.has(oldKey)) {
			pendingMoves.set(newKey, pendingMoves.get(oldKey));
			pendingMoves.delete(oldKey);
		}
		for (const v of pendingMoves.values()) {
			if (v.targetParentKey === oldKey) v.targetParentKey = newKey;
		}
	}

	function reset() {
		pendingMoves.clear();
		if (reorderTimer) {
			clearTimeout(reorderTimer);
			reorderTimer = null;
		}
	}

	return { schedule, recordMove, flush, rewriteKeys, reset };
}
