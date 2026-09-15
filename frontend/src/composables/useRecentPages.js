import { useStorage } from '@vueuse/core';
import { getCookieUser } from '../lib/cookieUser.js';

const LIMIT = 5;

// Keyed by user: localStorage outlives a logout, and the next user in this
// browser must not see the titles of pages they cannot read. Login and logout
// reload the page, so the key is read once.
const STORAGE_KEY = `wiki:recent-pages:${getCookieUser()}`;

// Module-level: useStorage syncs across tabs, not between callers in the same tab.
const recentPages = useStorage(STORAGE_KEY, [], localStorage);

export function useRecentPages() {
	function recordVisit({ name, title, space } = {}) {
		if (!name || !title) return;

		const rest = recentPages.value.filter((page) => page.name !== name);
		recentPages.value = [{ name, title, space: space || null }, ...rest].slice(
			0,
			LIMIT,
		);
	}

	return { recentPages, recordVisit };
}
