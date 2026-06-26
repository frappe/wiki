import { reactive } from 'vue';

function makeTempKey() {
	const rand =
		globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
	return `tmp_${rand}`;
}

function isTempKey(key) {
	return typeof key === 'string' && key.startsWith('tmp_');
}

// Tracks tmp_* → real key bookkeeping for optimistic creates. Other
// modules (the operation queue, move scheduler, save serializer) hold
// state keyed by docKey too, but each owns its own rewrite — they
// subscribe via `onResolve` and update their own internal maps. That
// keeps this module from reaching into anyone else's state.
export function createTempKeyResolver() {
	// Reactive so consumers (e.g. DraftContributionPanel) can swap routes
	// when a create resolves.
	const tempKeyResolutions = reactive({});
	// In-flight create promises keyed by tmp key. Dependent mutations on
	// a pending temp node await the corresponding promise before issuing
	// backend calls (which would otherwise hit the server with a tmp_*
	// key that doesn't exist).
	const createInFlight = new Map();
	const listeners = new Set();

	// Cheap synchronous lookup (does NOT await an in-flight create).
	function resolveKey(key) {
		return key ? tempKeyResolutions[key] || null : null;
	}

	function registerCreate(tempKey, promise) {
		createInFlight.set(tempKey, promise);
	}

	function finishCreate(tempKey) {
		createInFlight.delete(tempKey);
	}

	function resolve(tempKey, realKey) {
		if (!tempKey || !realKey || tempKey === realKey) return;
		tempKeyResolutions[tempKey] = realKey;
		for (const listener of listeners) {
			try {
				listener(tempKey, realKey);
			} catch (err) {
				console.warn('[tempKeyResolver] resolve listener failed', err);
			}
		}
	}

	function onResolve(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	// Resolve a docKey to its real server key. Plain keys pass through;
	// tmp_* keys await their in-flight create, then return the realKey
	// (or null if the create failed or was never issued).
	async function resolveDocKey(docKey) {
		if (!docKey || !isTempKey(docKey)) return docKey;
		if (tempKeyResolutions[docKey]) return tempKeyResolutions[docKey];
		const inFlight = createInFlight.get(docKey);
		if (!inFlight) return null;
		try {
			return (await inFlight) || null;
		} catch (_err) {
			return null;
		}
	}

	function reset() {
		for (const k of Object.keys(tempKeyResolutions)) {
			delete tempKeyResolutions[k];
		}
		createInFlight.clear();
	}

	return {
		tempKeyResolutions,
		makeTempKey,
		isTempKey,
		registerCreate,
		finishCreate,
		resolve,
		onResolve,
		resolveDocKey,
		resolveKey,
		reset,
	};
}

export { makeTempKey, isTempKey };
