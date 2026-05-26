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
