<template>
	<Dialog
		v-model:open="showCommandPalette"
		size="xl"
		position="top"
		bare
		@after-leave="onClose"
	>
		<Dialog.Title class="sr-only">{{ __('Search') }}</Dialog.Title>
		<div class="relative border-b border-outline-gray-2">
			<span
				class="lucide-search pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-gray-5"
				aria-hidden="true"
			/>
			<input
				v-model="query"
				autofocus
				type="text"
				autocomplete="off"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded="true"
				aria-controls="command-palette-results"
				:aria-activedescendant="activeItem ? itemId(activeItem) : undefined"
				:placeholder="__('Search')"
				class="w-full border-none bg-transparent py-3 pl-11 pr-4 text-base text-ink-gray-8 placeholder-ink-gray-4 focus:ring-0"
				@keydown="onKeydown"
			/>
		</div>

		<div
			id="command-palette-results"
			ref="resultsRef"
			class="max-h-96 overflow-y-auto p-2"
			role="listbox"
			:aria-label="__('Search results')"
		>
			<div
				v-for="group in groups"
				:key="group.id"
				role="group"
				:aria-labelledby="`command-palette-group-${group.id}`"
				class="mb-2 last:mb-0"
			>
				<div
					:id="`command-palette-group-${group.id}`"
					class="px-2 pb-1 pt-2 text-sm text-ink-gray-5"
				>
					{{ group.title }}
				</div>
				<div
					v-for="item in group.items"
					:id="itemId(item)"
					:key="item.key"
					role="option"
					:aria-selected="item === activeItem ? 'true' : 'false'"
					class="flex cursor-pointer items-center rounded-4 px-2 py-2 text-base-medium text-ink-gray-7"
					:class="{ 'bg-surface-gray-3': item === activeItem }"
					@click="select(item)"
					@mousemove="activeKey = item.key"
				>
					<SpaceAvatar
						v-if="item.space"
						:space="item.space"
						:label="item.label"
						size="xs"
						class="mr-3 shrink-0"
					/>
					<span
						v-else
						:class="[item.icon, 'mr-3 size-4 shrink-0 text-ink-gray-6']"
						aria-hidden="true"
					/>
					<div class="min-w-0 flex-1">
						<div class="truncate">{{ item.label }}</div>
						<div
							v-if="item.subtitle"
							class="mt-0.5 truncate text-sm text-ink-gray-5"
						>
							{{ item.subtitle }}
						</div>
					</div>
					<Tooltip v-if="item.unpublished" :text="__('Unpublished')">
						<span
							class="lucide-eye-off ml-2 size-3.5 shrink-0 text-ink-gray-4"
							aria-hidden="true"
						/>
					</Tooltip>
				</div>
			</div>

			<p
				v-if="!flatItems.length"
				class="px-2 py-6 text-center text-base text-ink-gray-5"
			>
				{{ pages.loading ? __('Searching…') : __('No results') }}
			</p>
		</div>

		<div
			class="flex items-center justify-between border-t border-outline-gray-2 px-3 py-2 text-sm text-ink-gray-5"
		>
			<div class="flex items-center gap-4">
				<span class="flex items-center gap-1">
					<KeyboardShortcut bg combo="ArrowDown" use-icons />
					<KeyboardShortcut bg combo="ArrowUp" use-icons />
					{{ __('to navigate') }}
				</span>
				<span class="flex items-center gap-1">
					<KeyboardShortcut bg combo="Enter" use-icons />
					{{ __('to select') }}
				</span>
				<span class="flex items-center gap-1">
					<KeyboardShortcut bg combo="Escape" />
					{{ __('to close') }}
				</span>
			</div>
			<span class="flex items-center gap-1">
				<KeyboardShortcut bg combo="Mod+K" />
				{{ __('to open') }}
			</span>
		</div>
	</Dialog>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import { watchDebounced } from '@vueuse/core';
import {
	Dialog,
	KeyboardShortcut,
	Tooltip,
	createResource,
	useKeyboardShortcut,
	useList,
} from 'frappe-ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useCommandPalette } from '../composables/useCommandPalette';
import { useRecentPages } from '../composables/useRecentPages';
import { MIN_SERVER_QUERY, buildResultGroups } from '../lib/commandPalette';
import SpaceAvatar from './SpaceAvatar.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const { showCommandPalette, close, toggle } = useCommandPalette();
const { recentPages } = useRecentPages();

const query = ref('');
// By key, not index, so rows that land late don't move the selection.
const activeKey = ref(null);
const resultsRef = ref(null);

const currentSpace = computed(() => route.params.spaceId || null);

useKeyboardShortcut({
	combo: 'Mod+K',
	description: __('Search'),
	allowInInput: true,
	allowInDialog: true,
	preventDefault: false,
	handler: (event) => {
		if (event.defaultPrevented) return;
		event.preventDefault();
		toggle();
	},
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
	],
	filters: () => (userStore.isWikiManager ? {} : { is_published: 1 }),
	orderBy: 'last_edited desc',
	limit: 1000,
	immediate: false,
});

const pages = createResource({ url: 'wiki.api.search.search_pages' });

watch(showCommandPalette, (open) => {
	if (open && !spaces.data) spaces.fetch();
});

watchDebounced(
	query,
	(value) => {
		const q = value.trim();
		if (q.length >= MIN_SERVER_QUERY) pages.submit({ query: q });
	},
	{ debounce: 300 },
);

// Enough for a page in the current space to win a tie, not to bury a better match.
const SPACE_BIAS = 1.5;

const jumpTo = [
	{
		key: 'overview',
		label: __('All Spaces'),
		icon: 'lucide-library',
		route: { name: 'Overview' },
	},
	{
		key: 'change-requests',
		label: __('Change Requests'),
		icon: 'lucide-git-branch',
		route: { name: 'ChangeRequests' },
	},
];

const spaceItems = computed(() =>
	(spaces.data || []).map((space) => ({
		key: `space:${space.name}`,
		label: space.space_name || space.name,
		// Space names are not unique.
		subtitle: space.route && `/${space.route}`,
		space,
		unpublished: !space.is_published,
		route: { name: 'SpaceDetails', params: { spaceId: space.name } },
	})),
);

function toPageItem(page) {
	return {
		key: `page:${page.name}`,
		label: page.title,
		path: pathInSpace(page),
		icon: 'lucide-file-text',
		subtitle: `/${page.route}`,
		unpublished: !page.is_published,
		scoreScale: page.wiki_space === currentSpace.value ? SPACE_BIAS : 1,
		route: {
			name: 'SpacePage',
			params: { spaceId: page.wiki_space, pageId: page.name },
		},
	};
}

/** `docs/guides/auth-tokens` in space `docs` -> `guides/auth-tokens`. */
function pathInSpace(page) {
	const route = page.route || '';
	return route.slice(route.indexOf('/') + 1);
}

const pageItems = computed(() => (pages.data || []).map(toPageItem));

const recentItems = computed(() =>
	recentPages.value
		.filter((page) => page.name !== route.params.pageId)
		.map((page) => ({
			key: `recent:${page.name}`,
			label: page.title,
			icon: 'lucide-file-text',
			// Visits saved before routes were recorded fall back to the space name.
			subtitle: page.route ? `/${page.route}` : spaceNames.value.get(page.space),
			route: {
				name: 'SpacePage',
				params: { spaceId: page.space, pageId: page.name },
			},
		})),
);

const spaceNames = computed(
	() =>
		new Map(
			(spaces.data || []).map((space) => [
				space.name,
				space.space_name || space.name,
			]),
		),
);

const groups = computed(() =>
	buildResultGroups(query.value, {
		jumpTo,
		spaces: spaceItems.value,
		pages: pageItems.value,
		recent: recentItems.value,
		titles: {
			jump: __('Jump to'),
			spaces: __('Spaces'),
			pages: __('Pages'),
			recent: __('Recent'),
		},
	}),
);

const flatItems = computed(() => groups.value.flatMap((group) => group.items));
const activeIndex = computed(() => {
	const index = flatItems.value.findIndex(
		(item) => item.key === activeKey.value,
	);
	return index === -1 ? 0 : index;
});
const activeItem = computed(() => flatItems.value[activeIndex.value]);

watch(query, () => {
	activeKey.value = null;
});

function onKeydown(event) {
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		move(event.key === 'ArrowDown' ? 1 : -1);
	} else if (event.key === 'Enter' && activeItem.value) {
		event.preventDefault();
		select(activeItem.value);
	}
}

function move(step) {
	const count = flatItems.value.length;
	if (!count) return;
	activeKey.value =
		flatItems.value[(activeIndex.value + step + count) % count].key;
	nextTick(() => {
		resultsRef.value
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: 'nearest' });
	});
}

function select(item) {
	close();
	router.push(item.route);
}

function onClose() {
	query.value = '';
	activeKey.value = null;
}

function itemId(item) {
	return `command-palette-item-${item.key.replace(/[^\w-]/g, '-')}`;
}
</script>
