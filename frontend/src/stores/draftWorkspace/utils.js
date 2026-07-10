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

// Frappe checkbox fields arrive as 0/1 ints over JSON, so `!== false` reads
// an unpublished page (0) as published. Missing/null still defaults to
// published (legacy and git-synced nodes omit the flag).
export function toPublished(value) {
	return value == null ? true : Boolean(value);
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
		isPublished: toPublished(node?.isPublished),
		saveStatus: 'idle',
		error: null,
	};
}
