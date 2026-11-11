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

const RETRIED_SERVER_ERRORS = new Set([
	'AuthenticationError',
	'CSRFTokenError',
	'QueryDeadlockError',
	'QueryTimeoutError',
	'SessionExpired',
	'TimestampMismatchError',
	'TooManyRequestsError',
]);

// No `exc_type` means the server never answered, so the op may yet land. A
// signed-out user gets a PermissionError too, and must not lose work to it.
export function isRetryableError(err, signedOut = false) {
	if (!err?.exc_type || RETRIED_SERVER_ERRORS.has(err.exc_type)) return true;
	return signedOut && err.exc_type === 'PermissionError';
}

// No hyphens: the server's wiki link and OG image patterns reject them.
// getRandomValues also works on plain HTTP, where randomUUID is missing.
export function makeDocKey() {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	);
}
