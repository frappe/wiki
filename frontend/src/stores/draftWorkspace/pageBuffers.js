import { computed, reactive } from 'vue';

function emptyPage(docKey, opts = {}) {
	return {
		docKey,
		content: opts.content ?? '',
		localContent: opts.localContent ?? null,
		serverContent: opts.serverContent ?? null,
		serverHash: opts.serverHash ?? null,
		sentContent: opts.sentContent ?? null,
		saveStatus: opts.saveStatus ?? 'idle',
		error: null,
	};
}

// Per-doc editor buffers. `content` is the server-confirmed baseline while
// `localContent` retains a divergent local snapshot across navigation and
// restore. Both values are canonicalized by WikiEditor before comparison.
// `serverContent` is the raw server copy the local edits build on, `serverHash`
// its hash, sent with each save, and `sentContent` a save whose reply never
// came, so it may be on the server.
// Persistence and transport remain store concerns.
export function createPageBuffers() {
	const pagesByKey = reactive({});

	function isDirty(page) {
		return page?.localContent != null && page.localContent !== page.content;
	}

	// False once the page changed elsewhere: saving the local edits then
	// would overwrite that change.
	function isBasedOn(page, serverContent) {
		return (
			serverContent === page.serverContent || serverContent === page.sentContent
		);
	}

	// Submit/merge gate on derived divergence, so every caller sees the
	// same answer without coordinating a separate mutable dirty flag.
	const hasUnsavedEditorContent = computed(() => {
		for (const key of Object.keys(pagesByKey)) {
			if (isDirty(pagesByKey[key])) return true;
		}
		return false;
	});

	function dirtyPages() {
		return Object.keys(pagesByKey)
			.map((key) => pagesByKey[key])
			.filter((page) => isDirty(page));
	}

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
		dirtyPages,
		emptyPage,
		isDirty,
		isBasedOn,
		get,
		setPage,
		deletePage,
		ensure,
		setLocalContent,
		clearLocalContent,
		reconcileEditorContent,
		clearFailedFlag,
		reset,
	};
}
