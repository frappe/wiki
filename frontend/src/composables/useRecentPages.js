import { useStorage } from '@vueuse/core';

const STORAGE_KEY = 'wiki:recent-pages';
const LIMIT = 5;

// Module-level: useStorage syncs across tabs, not between callers in the same tab.
const recentPages = useStorage(STORAGE_KEY, []);

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
