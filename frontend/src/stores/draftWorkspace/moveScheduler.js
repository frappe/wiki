// Debounced drag/reorder scheduler. Coalesces rapid drags into a single
// batched backend call (one move op per dragged node + one reorder op per
// touched parent) so per-drag noise doesn't translate to N round-trips.
export function createMoveScheduler({
	ensureCreated,
	queue,
	treeModel,
	transport,
	crName,
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

	async function ensureAllCreated(docKeys) {
		const results = await Promise.allSettled(docKeys.map(ensureCreated));
		return results.every((result) => result.status === 'fulfilled');
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
			// Pack every drag (and its parent's full sibling order)
			// into a single atomic batch so the backend sees one
			// user intent rather than a chain of move/reorder pairs.
			const ops = [];
			const reorderedParents = new Set();
			for (const [docKey, { targetParentKey }] of snapshot) {
				if (
					!targetParentKey ||
					!(await ensureAllCreated([docKey, targetParentKey]))
				) {
					failedKeys.push(docKey);
					continue;
				}
				const node = treeModel.findNode(docKey);
				const parentList = node ? treeModel.getChildList(node.parentKey) : null;
				const newIndex = parentList
					? parentList.findIndex((n) => n.docKey === docKey)
					: 0;
				const muId =
					moveMutations.find((m) => m.payload?.docKey === docKey)?.id || docKey;
				ops.push({
					id: `${muId}-move`,
					type: 'move_node',
					doc_key: docKey,
					target_parent_key: targetParentKey,
					order_index: Math.max(0, newIndex),
				});
				if (!reorderedParents.has(targetParentKey)) {
					reorderedParents.add(targetParentKey);
					const siblingKeys = (parentList || []).map((n) => n.docKey);
					// The server skips a sibling whose create failed.
					await ensureAllCreated(siblingKeys);
					if (siblingKeys.length) {
						ops.push({
							id: `${targetParentKey}-reorder`,
							type: 'reorder_children',
							parent_key: targetParentKey,
							ordered_doc_keys: siblingKeys,
						});
					}
				}
			}
			if (ops.length) await transport.applyBatchOps(ops);
			for (const [docKey] of snapshot) {
				if (failedKeys.includes(docKey)) continue;
				const fresh = treeModel.findNode(docKey);
				if (fresh) fresh.localStatus = null;
			}
			for (const m of moveMutations) {
				if (failedKeys.includes(m.payload?.docKey)) {
					queue.setStatus(m.id, 'failed', 'Pending create did not resolve');
				} else {
					queue.clear(m.id);
				}
			}
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

	function reset() {
		pendingMoves.clear();
		if (reorderTimer) {
			clearTimeout(reorderTimer);
			reorderTimer = null;
		}
	}

	return { schedule, recordMove, flush, reset };
}
