import { createStore, del, get, keys, set } from 'idb-keyval';

// IndexedDB-backed persistence for unsaved editor content. Entries
// survive browser refresh and tab close, so a user who typed something
// and refreshed (or crashed) before autosave fired doesn't lose it.
//
// We deliberately use a dedicated IDB database ("wiki-drafts") instead
// of the default `keyval-store` that frappe-ui's data-fetching layer
// owns, so neither side can stomp the other's keys.
//
// Keys are namespaced `cr:<changeRequestName>:<docKey>` so we can scan
// a single CR's drafts on hydrate without listing every CR's history.

const PREFIX = 'cr:';
const wikiDraftStore = createStore('wiki-drafts', 'drafts');

function makeKey(crName, docKey) {
	return `${PREFIX}${crName}:${docKey}`;
}

// All draft IDB calls are best-effort. Browsers may disable IndexedDB
// (private mode in older Safari, restrictive enterprise policies). We
// surface failures to the console but never let them break the editor
// — the existing in-memory flow continues to work without persistence.
export async function saveDraft(crName, docKey, payload) {
	if (!crName || !docKey) return;
	try {
		await set(
			makeKey(crName, docKey),
			{ ...payload, savedAt: Date.now() },
			wikiDraftStore,
		);
	} catch (err) {
		console.warn('[draftPersistence] saveDraft failed', err);
	}
}

export async function clearDraft(crName, docKey) {
	if (!crName || !docKey) return;
	try {
		await del(makeKey(crName, docKey), wikiDraftStore);
	} catch (err) {
		console.warn('[draftPersistence] clearDraft failed', err);
	}
}

// Delete every persisted draft for the given CR. Used when a change request
// is discarded or merged so its drafts can't be restored on the next hydrate
// (`clearDraft` is per-doc and needs a docKey we don't always have here).
export async function clearDraftsForCr(crName) {
	if (!crName) return;
	const wanted = `${PREFIX}${crName}:`;
	try {
		const allKeys = await keys(wikiDraftStore);
		const matches = allKeys.filter(
			(k) => typeof k === 'string' && k.startsWith(wanted),
		);
		await Promise.all(matches.map((k) => del(k, wikiDraftStore)));
	} catch (err) {
		console.warn('[draftPersistence] clearDraftsForCr failed', err);
	}
}

// Read every persisted draft for the given CR. Returns an array of
// `{ docKey, content, title, savedAt }`. Used by `hydrate` to restore
// dirty editor state after a refresh.
export async function loadDraftsForCr(crName) {
	if (!crName) return [];
	const wanted = `${PREFIX}${crName}:`;
	try {
		const allKeys = await keys(wikiDraftStore);
		const matches = allKeys.filter(
			(k) => typeof k === 'string' && k.startsWith(wanted),
		);
		const entries = await Promise.all(
			matches.map(async (k) => {
				const value = await get(k, wikiDraftStore);
				if (!value) return null;
				return { docKey: k.slice(wanted.length), ...value };
			}),
		);
		return entries.filter(Boolean);
	} catch (err) {
		console.warn('[draftPersistence] loadDraftsForCr failed', err);
		return [];
	}
}
