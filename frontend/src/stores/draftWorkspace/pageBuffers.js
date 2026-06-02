import { computed, reactive } from 'vue';

function emptyPage(docKey, opts = {}) {
	return {
		docKey,
		title: opts.title ?? '',
		route: opts.route ?? '',
		content: opts.content ?? '',
		localContent: opts.localContent ?? null,
		isPublished: opts.isPublished ?? true,
		saveStatus: opts.saveStatus ?? 'idle',
		error: null,
	};
}

// Per-doc editor buffers. `content` is the server-confirmed baseline while
// `localContent` retains a divergent local snapshot across navigation and
// restore. Both values are canonicalized by WikiEditor before comparison.
// Persistence and transport remain store concerns.
export function createPageBuffers() {
	const pagesByKey = reactive({});

	function isDirty(page) {
		return page?.localContent != null && page.localContent !== page.content;
	}

	// Submit/merge gate on derived divergence, so every caller sees the
	// same answer without coordinating a separate mutable dirty flag.
	const hasUnsavedEditorContent = computed(() => {
		for (const key of Object.keys(pagesByKey)) {
			if (isDirty(pagesByKey[key])) return true;
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
		page.localContent = content === page.content ? null : content;
		if (title != null) page.title = title;
		if (finalKey !== docKey) {
			pagesByKey[finalKey] = page;
			delete pagesByKey[docKey];
		}
		return page;
	}

	function setLocalContent(docKey, content) {
		const page = pagesByKey[docKey];
		if (!page) return null;
		page.localContent = content === page.content ? null : content;
		return page;
	}

	function clearLocalContent(docKey) {
		const page = pagesByKey[docKey];
		if (page) page.localContent = null;
	}

	function reconcileEditorContent(docKey, content, savedContent) {
		const page = ensure(docKey);
		page.content = savedContent;
		page.localContent = content === savedContent ? null : content;
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
			page.saveStatus = 'idle';
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
		isDirty,
		get,
		setPage,
		deletePage,
		ensure,
		updateLocalContent,
		setLocalContent,
		clearLocalContent,
		reconcileEditorContent,
		promoteKey,
		clearFailedFlag,
		reset,
	};
}
