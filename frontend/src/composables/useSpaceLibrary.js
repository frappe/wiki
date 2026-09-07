import { createResource, useList } from 'frappe-ui';
import { computed, ref, unref, watch } from 'vue';

import { orderSpaces, usePinnedSpaces } from './usePinnedSpaces';

// The Overview page is the full directory, so it pages in useful chunks. The
// sidebar asks for far fewer (see SIDEBAR_LIMIT) and sends you here for the
// rest.
const PAGE_SIZE = 50;

/**
 * The library list, as both the sidebar and the Overview page need it: the same
 * query, the same search, the same pinned-first order. Each caller gets its own
 * instance — the two surfaces page and search independently.
 *
 * `publishedOnly` drops unpublished spaces from the query. The sidebar sets it
 * for everyone but a Wiki Manager, whose own unpublished drafts have to stay in
 * the column they work in.
 */
export function useSpaceLibrary({ limit = PAGE_SIZE, publishedOnly } = {}) {
	const { pinnedSpaces, isPinned, togglePin } = usePinnedSpaces();

	const searchQuery = ref('');
	const searchTerm = ref('');
	let searchDebounce = null;
	watch(searchQuery, (value) => {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			searchTerm.value = value.trim();
		}, 250);
	});

	// switcher_order is the space's declared position, but it defaults to 0 for
	// every space, so the newest space would otherwise land in an arbitrary spot
	// in the list. Creation order breaks the tie the way the old list page did.
	const spaces = useList({
		doctype: 'Wiki Space',
		fields: [
			'name',
			'space_name',
			'route',
			'app_switcher_logo',
			'space_icon',
			'space_color',
			'avatar',
			'is_published',
			'git_synced',
			'switcher_order',
		],
		filters: () => ({
			...(searchTerm.value
				? { space_name: ['like', `%${searchTerm.value}%`] }
				: {}),
			...(unref(publishedOnly) ? { is_published: 1 } : {}),
		}),
		orderBy: 'switcher_order asc, creation desc',
		limit,
	});

	// A new search has to start from the top, but useList exposes `start` readonly
	// and no reset — and a fetch from a non-zero start *appends* to the rows the
	// last search left behind. Walking `previous()` back to 0 is the reset; the
	// writes are synchronous, so the URL settles once and refetches once.
	watch(searchTerm, () => {
		while (spaces.start > 0) spaces.previous();
	});

	// `isWikiManager` lands after the session user resource resolves, usually
	// *after* the first fetch. The reactive `filters` refetches on its own; this
	// only rewinds the paging, same as a new search.
	watch(
		() => unref(publishedOnly),
		() => {
			while (spaces.start > 0) spaces.previous();
		},
	);

	const orderedSpaces = computed(() =>
		orderSpaces(spaces.data || [], pinnedSpaces.value),
	);

	// The filter is only worth its row when the list is long enough to need it —
	// on a wiki with a handful of spaces it is just a box between you and them.
	const showSearch = computed(
		() => Boolean(searchTerm.value) || (spaces.data || []).length >= 10,
	);

	const isEmptyWiki = computed(
		() => !spaces.loading && !searchTerm.value && !(spaces.data || []).length,
	);

	// Restricted means "readable only by specific roles" — the backend works that
	// out from the space's role rows (no rows is open to all, a Guest row is
	// public), so this is one call per page of spaces, not a child table per row.
	const restrictedResource = createResource({
		url: 'wiki.api.wiki_space.get_restricted_spaces',
	});
	const restrictedSpaces = computed(
		() => new Set(restrictedResource.data || []),
	);
	watch(
		() => (spaces.data || []).map((space) => space.name).join(','),
		(names) => {
			if (names) restrictedResource.submit({ spaces: names.split(',') });
		},
		{ immediate: true },
	);

	return {
		spaces,
		searchQuery,
		showSearch,
		orderedSpaces,
		isEmptyWiki,
		restrictedSpaces,
		isPinned,
		togglePin,
	};
}
