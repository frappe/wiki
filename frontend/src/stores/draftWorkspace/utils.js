// Shared pure helpers for the draft workspace store. Kept dependency-free
// so any sub-module can import them without pulling in Vue or Pinia.

export function slugify(text) {
	return String(text || '')
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function errorMessage(err) {
	return err?.messages?.[0] || err?.message || String(err);
}

// Buffer seed for an editor draft restored from IndexedDB. The tree node is
// the authority for route and publish state — a restored buffer must not
// invent them, or an unpublished page shows a "Published" badge after a
// reload with unsaved edits (buffer said true, tree said false).
export function restoredDraftBuffer({
	docKey,
	title,
	content,
	localContent,
	node,
}) {
	return {
		docKey,
		title: title || '',
		route: node?.route || '',
		content,
		localContent,
		isPublished: node?.isPublished !== false,
		saveStatus: 'idle',
		error: null,
	};
}
