// Per-doc save chain. While one save is in flight, subsequent calls
// collapse to the latest content and run after. This avoids older
// requests landing after newer ones and overwriting backend content
// (the frontend can't observe HTTP write order, so we guarantee
// ordering by not racing).
//
// Callers hand in a `runFn(content, title)` closure that performs the
// actual transport — this module knows nothing about the network.
export function createSaveSerializer() {
	const saveTails = new Map(); // docKey -> Promise (current chain tail)
	const queuedSaves = new Map(); // docKey -> { content, title }

	function enqueueSave(docKey, content, title, runFn) {
		// Always overwrite any queued save so we only ever run with the
		// latest content.
		queuedSaves.set(docKey, { content, title });

		const tail = saveTails.get(docKey) || Promise.resolve();
		const next = tail
			.catch(() => {})
			.then(async () => {
				const params = queuedSaves.get(docKey);
				if (!params) return; // collapsed by a later call that already ran
				queuedSaves.delete(docKey);
				return runFn(params.content, params.title);
			});
		saveTails.set(docKey, next);
		next.finally(() => {
			if (saveTails.get(docKey) === next) saveTails.delete(docKey);
		});
		return next;
	}

	function hasQueuedFor(docKey) {
		return queuedSaves.has(docKey);
	}

	function rewriteKeys(oldKey, newKey) {
		if (!oldKey || !newKey || oldKey === newKey) return;
		if (saveTails.has(oldKey)) {
			saveTails.set(newKey, saveTails.get(oldKey));
			saveTails.delete(oldKey);
		}
		if (queuedSaves.has(oldKey)) {
			queuedSaves.set(newKey, queuedSaves.get(oldKey));
			queuedSaves.delete(oldKey);
		}
	}

	function reset() {
		saveTails.clear();
		queuedSaves.clear();
	}

	return { enqueueSave, hasQueuedFor, rewriteKeys, reset };
}
