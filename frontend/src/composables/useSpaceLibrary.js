import { createResource, useList } from 'frappe-ui';
import { computed, ref, unref, watch } from 'vue';

import { orderSpaces, usePinnedSpaces } from './usePinnedSpaces';

// The Overview page is the full directory, so it pages in useful chunks. The
// sidebar asks for far fewer (see SIDEBAR_LIMIT) and sends you here for the
// rest.
const PAGE_SIZE = 50;

// switcher_order is the space's declared position, but it defaults to 0 for
// every space, so the newest space would otherwise land in an arbitrary spot
// in the list. Creation order breaks the tie the way the old list page did.
const DECLARED_ORDER = 'switcher_order asc, creation desc';

/**
 * The library list, as both the sidebar and the Overview page need it: the same
 * query, the same search, the same pinned-first order. Each caller gets its own
 * instance — the two surfaces page and search independently.
 *
 * `publishedOnly` drops unpublished spaces from the query. The sidebar sets it
 * for everyone but a Wiki Manager, whose own unpublished drafts have to stay in
 * the column they work in. `publishState` is the directory's own three-way
 * filter on the same field, and applies on top.
 *
 * `withStats` adds the per-page figures call. Off by default: the sidebar draws
 * names, not numbers, and should not pay for them.
 *
 * `orderBy` is the directory's declared order unless a caller says otherwise;
 * the sidebar orders by recent activity instead (see LibrarySidebar).
 */
export function useSpaceLibrary({
	limit = PAGE_SIZE,
	orderBy = DECLARED_ORDER,
	publishedOnly,
	withStats = false,
} = {}) {
	const { pinnedSpaces, isPinned, togglePin } = usePinnedSpaces();

	// 'all' | 'published' | 'unpublished'. Server-side, like the search term:
	// filtering the rows already fetched would make "Load more" page through a
	// list the user is not looking at.
	const publishState = ref('all');

	const searchQuery = ref('');
	const searchTerm = ref('');
	let searchDebounce = null;
	watch(searchQuery, (value) => {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			searchTerm.value = value.trim();
		}, 250);
	});

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
			...(publishState.value === 'published' ? { is_published: 1 } : {}),
			...(publishState.value === 'unpublished' ? { is_published: 0 } : {}),
		}),
		orderBy,
		limit,
	});

	// A new search has to start from the top, but useList exposes `start` readonly
	// and no reset — and a fetch from a non-zero start *appends* to the rows the
	// last search left behind. Walking `previous()` back to 0 is the reset; the
	// writes are synchronous, so the URL settles once and refetches once.
	watch([searchTerm, publishState], () => {
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

	// "This wiki has no spaces", not "this filter found none" -- the distinction
	// matters because the empty-wiki state replaces the whole page, controls
	// included, so claiming it while a filter is on strands the user with no way
	// back to the list.
	const isEmptyWiki = computed(
		() =>
			!spaces.loading &&
			!searchTerm.value &&
			publishState.value === 'all' &&
			!(spaces.data || []).length,
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

	// Same shape as the restricted lookup above: one call per page of spaces,
	// keyed off the names that came back, not a query per row.
	const statsResource = createResource({
		url: 'wiki.api.wiki_space.get_space_stats',
	});
	const spaceStats = computed(() => statsResource.data || {});
	if (withStats) {
		watch(
			() => (spaces.data || []).map((space) => space.name).join(','),
			(names) => {
				if (names) statsResource.submit({ spaces: names.split(',') });
			},
			{ immediate: true },
		);
	}

	return {
		spaces,
		searchQuery,
		publishState,
		spaceStats,
		showSearch,
		orderedSpaces,
		isEmptyWiki,
		restrictedSpaces,
		isPinned,
		togglePin,
	};
}
