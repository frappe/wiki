import { computed, reactive } from 'vue';

function emptyPage(docKey, opts = {}) {
	return {
		docKey,
		title: opts.title ?? '',
		route: opts.route ?? '',
		content: opts.content ?? '',
		isPublished: opts.isPublished ?? true,
		dirty: opts.dirty ?? false,
		saveStatus: opts.saveStatus ?? 'idle',
		error: null,
	};
}

// Per-doc editor buffers (title/content/dirty/saveStatus). Knows nothing
// about persistence or transport — the store wires those in.
export function createPageBuffers() {
	const pagesByKey = reactive({});

	// Any page whose local content differs from what the server has — this
	// covers post-save 'failed' state and pre-debounce editor typing alike,
	// since both flip `page.dirty` true. Submit/merge gate on this so a
	// user can't ship a CR that doesn't yet contain what they see on
	// screen.
	const hasUnsavedEditorContent = computed(() => {
		for (const key of Object.keys(pagesByKey)) {
			if (pagesByKey[key]?.dirty) return true;
		}
		return false;
	});

	function get(docKey) {
		return pagesByKey[docKey] || null;
	}

	function setPage(docKey, page) {
		pagesByKey[docKey] = page;
		return page;
	}

	function deletePage(docKey) {
		delete pagesByKey[docKey];
	}

	function ensure(docKey, opts) {
		let page = pagesByKey[docKey];
		if (!page) page = pagesByKey[docKey] = emptyPage(docKey, opts);
		return page;
	}

	function markDirty(docKey) {
		if (!docKey) return;
		const page = pagesByKey[docKey];
		if (!page) {
			// Lazy-create a stub so the WikiDocumentPanel flow (which
			// caches its page in a local ref, not `pagesByKey`) can still
			// register dirty state.
			pagesByKey[docKey] = emptyPage(docKey, {
				dirty: true,
				saveStatus: 'dirty',
			});
			return;
		}
		if (page.saveStatus === 'saving') return;
		page.dirty = true;
		page.saveStatus = 'dirty';
	}

	// The dirty→clean edge for an editor whose content went back to the
	// last saved value (typed-then-undone). Without this, the dirty flag
	// would stick and keep Submit/merge gated until the user issued a
	// redundant save. Safe no-op while a save is in flight.
	function markClean(docKey) {
		if (!docKey) return;
		const page = pagesByKey[docKey];
		if (!page) return;
		if (page.saveStatus === 'saving') return;
		if (page.dirty || page.saveStatus === 'dirty') {
			page.dirty = false;
			page.saveStatus = page.saveStatus === 'failed' ? 'failed' : 'idle';
			if (page.saveStatus !== 'failed') page.error = null;
		}
	}

	function updateLocalContent(docKey, realKey, content, title) {
		const finalKey = realKey || docKey;
		if (!finalKey) return null;
		let page = pagesByKey[finalKey] || pagesByKey[docKey];
		if (!page) {
			page = pagesByKey[finalKey] = emptyPage(finalKey, {
				title: title || '',
			});
		}
		page.docKey = finalKey;
		page.content = content;
		if (title != null) page.title = title;
		page.dirty = true;
		page.saveStatus = 'dirty';
		page.error = null;
		if (finalKey !== docKey) {
			pagesByKey[finalKey] = page;
			delete pagesByKey[docKey];
		}
		return page;
	}

	// Swap a tmp_* keyed buffer over to its real key once the create syncs.
	function promoteKey(tempKey, realKey, extras = {}) {
		if (!tempKey || !realKey || tempKey === realKey) return;
		const page = pagesByKey[tempKey];
		if (!page) return;
		pagesByKey[realKey] = {
			...page,
			docKey: realKey,
			route: extras.route ?? page.route,
		};
		delete pagesByKey[tempKey];
	}

	function clearFailedFlag(docKey) {
		const page = pagesByKey[docKey];
		if (!page) return;
		if (page.saveStatus === 'failed') {
			page.saveStatus = page.dirty ? 'dirty' : 'idle';
			page.error = null;
		}
	}

	function reset() {
		for (const k of Object.keys(pagesByKey)) delete pagesByKey[k];
	}

	return {
		pagesByKey,
		hasUnsavedEditorContent,
		emptyPage,
		get,
		setPage,
		deletePage,
		ensure,
		markDirty,
		markClean,
		updateLocalContent,
		promoteKey,
		clearFailedFlag,
		reset,
	};
}
