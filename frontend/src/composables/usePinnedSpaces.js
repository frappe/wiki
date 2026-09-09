import { useStorage } from '@vueuse/core';

// Pins are per-user and per-browser. They stay in localStorage until someone
// asks for them to follow an account across devices — a field on Wiki Space
// would be a shared setting, which is the opposite of what a pin is.
const STORAGE_KEY = 'wiki:pinned-spaces';

/**
 * Pinned spaces float to the top in the order they were pinned; the rest keep
 * the order the list resource returned them in (switcher_order, then creation).
 *
 * Pins are kept for spaces that are not in the current page of the list — the
 * list is paged and searched, so an absent space usually means "not fetched",
 * not "deleted".
 */
export function orderSpaces(spaces, pinned) {
	const rank = new Map((pinned || []).map((name, index) => [name, index]));
	return [...(spaces || [])].sort((a, b) => {
		const aRank = rank.has(a.name)
			? rank.get(a.name)
			: Number.POSITIVE_INFINITY;
		const bRank = rank.has(b.name)
			? rank.get(b.name)
			: Number.POSITIVE_INFINITY;
		if (aRank === bRank) return 0;
		return aRank - bRank;
	});
}

export function usePinnedSpaces() {
	const pinnedSpaces = useStorage(STORAGE_KEY, []);

	function isPinned(name) {
		return pinnedSpaces.value.includes(name);
	}

	/** Returns the new pinned state, so callers can word their own toast. */
	function togglePin(name) {
		if (isPinned(name)) {
			pinnedSpaces.value = pinnedSpaces.value.filter((it) => it !== name);
			return false;
		}
		pinnedSpaces.value = [...pinnedSpaces.value, name];
		return true;
	}

	return { pinnedSpaces, isPinned, togglePin };
}
