// Per-doc save chain. While one save is in flight, subsequent calls
// collapse to the latest content and run after. This avoids older
// requests landing after newer ones and overwriting backend content
// (the frontend can't observe HTTP write order, so we guarantee
// ordering by not racing).
//
// Callers hand in a `runFn(content)` closure that performs the
// actual transport — this module knows nothing about the network.
export function createSaveSerializer() {
	const saveTails = new Map(); // docKey -> Promise (current chain tail)
	const queuedSaves = new Map(); // docKey -> content

	function enqueueSave(docKey, content, runFn) {
		// Always overwrite any queued save so we only ever run with the
		// latest content.
		queuedSaves.set(docKey, content);

		const tail = saveTails.get(docKey) || Promise.resolve();
		const next = tail
			.catch(() => {})
			.then(async () => {
				if (!queuedSaves.has(docKey)) return; // collapsed by a later call that already ran
				const queued = queuedSaves.get(docKey);
				queuedSaves.delete(docKey);
				return runFn(queued);
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

	function reset() {
		saveTails.clear();
		queuedSaves.clear();
	}

	return { enqueueSave, hasQueuedFor, reset };
}
