<template>
	<div class="flex flex-col h-full overflow-hidden">
		<!-- On mobile the title lives in the top nav; the inline header is hidden. -->
		<Teleport v-if="isMobile" to="#app-header">
			<h2 class="truncate text-base font-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</Teleport>
		<div class="hidden sm:flex items-center justify-between shrink-0 px-3 pt-4 pb-3 sm:px-5 sm:pt-5">
			<h2 class="text-xl font-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</div>

		<!-- Mobile: a tab strip is cramped at 375px, so switch tabs with a select. -->
		<template v-if="isMobile">
			<div class="px-3 pt-3 pb-3 shrink-0">
				<FormControl
					type="select"
					:options="tabSelectOptions"
					v-model="activeTabKey"
				/>
			</div>
			<ContributionsPanel
				:resource="panelFor(activeKey).resource"
				:columns="panelFor(activeKey).columns"
				:options="panelFor(activeKey).options"
				@assign="openAssign"
			/>
		</template>

		<Tabs v-else v-model="activeTabIndex" :tabs="tabs">
			<template #tab-panel="{ tab }">
				<ContributionsPanel
					:resource="panelFor(tab.key).resource"
					:columns="panelFor(tab.key).columns"
					:options="panelFor(tab.key).options"
					@assign="openAssign"
				/>
			</template>
		</Tabs>

		<AssignDialog
			v-if="assignTarget"
			v-model="showAssignDialog"
			:change-request-id="assignTarget"
			@assigned="onAssigned"
		/>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRouteQuery } from '@vueuse/router';
import { Tabs, FormControl, createListResource, usePageMeta } from 'frappe-ui';
import { useUserStore } from '@/stores/user';
import { useMobile } from '@/composables/useMobile';
import AssignDialog from '@/components/AssignDialog.vue';
import ContributionsPanel from '@/components/ContributionsPanel.vue';

const { isMobile } = useMobile();

usePageMeta(() => ({ title: `${__('Change Requests')} | Frappe Wiki` }));

const tabQuery = useRouteQuery('tab', 'my');
const userStore = useUserStore();
const isManager = computed(() => userStore.isWikiManager);
const currentUser = computed(() => userStore.data?.name);

const myChangeRequestColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Space'), key: 'space_name', width: 1.5 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Last Modified'), key: 'modified', width: 1.5 },
];

const reviewColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Author'), key: 'owner', width: 1 },
	{ label: __('Space'), key: 'space_name', width: 2 },
	{ label: __('Status'), key: 'status', width: '8rem' },
	{ label: __('Assignees'), key: 'assign', width: '6rem', align: 'right' },
	// Submitted is a compact, clock-marked date column anchored to the end; the
	// header text is dropped (the icon is the cue) and the full timestamp is on
	// hover, since the date alone is enough at a glance.
	{ label: '', key: 'modified', width: '7.5rem', align: 'right' },
];

const reviewRowRoute = (row) => ({ name: 'ChangeRequestReview', params: { changeRequestId: row.name } });

function getRowRoute(row) {
	if (row.status === 'Draft' || row.status === 'Changes Requested') {
		return { name: 'SpaceDetails', params: { spaceId: row.wiki_space } };
	}
	return { name: 'ChangeRequestReview', params: { changeRequestId: row.name } };
}

function listOptions(emptyState, rowRoute) {
	return {
		selectable: false,
		showTooltip: true,
		resizeColumn: false,
		getRowRoute: rowRoute,
		emptyState,
	};
}

// Each tab is a self-contained descriptor: the server-side filter, the columns
// to render, and its empty state. `filters` is a getter (not a frozen object)
// so the session user is read at fetch time and can never leak in as
// `undefined` — the bug this tab structure previously shipped with.
const tabDefs = computed(() => {
	const defs = [
		{
			key: 'my',
			label: __('My Change Requests'),
			// `wiki_space` (the link id) is needed for the row route to the space
			// editor; `wiki_space.space_name` only yields the display name.
			fields: ['name', 'title', 'wiki_space', 'wiki_space.space_name', 'status', 'modified', 'archived_at', 'merged_at'],
			filters: () => ({ owner: ['=', currentUser.value] }),
			columns: myChangeRequestColumns,
			options: listOptions({
				title: __('No Change Requests'),
				description: __('You have not created any change requests yet. Edit a wiki page to get started.'),
			}, getRowRoute),
		},
		{
			key: 'assigned',
			label: __('Assigned to me'),
			fields: ['name', 'title', 'wiki_space.space_name', 'status', 'owner', 'modified', '_assign'],
			filters: () => ({ _assign: ['like', `%${currentUser.value}%`], status: ['in', ['In Review', 'Approved']] }),
			columns: reviewColumns,
			options: listOptions({
				title: __('Nothing assigned to you'),
				description: __('Change requests assigned to you for review will appear here.'),
			}, reviewRowRoute),
		},
	];
	if (isManager.value) {
		defs.push({
			key: 'all',
			label: __('All in review'),
			fields: ['name', 'title', 'wiki_space.space_name', 'status', 'owner', 'modified', '_assign'],
			filters: () => ({ status: ['in', ['In Review', 'Approved']] }),
			columns: reviewColumns,
			options: listOptions({
				title: __('No change requests in review'),
				description: __('There are no change requests waiting for review.'),
			}, reviewRowRoute),
		});
	}
	return defs;
});

const tabs = computed(() => tabDefs.value.map((d) => ({ key: d.key, label: d.label })));

const activeTabIndex = computed({
	get() {
		const idx = tabs.value.findIndex((t) => t.key === tabQuery.value);
		return idx >= 0 ? idx : 0;
	},
	set(idx) {
		const tab = tabs.value[idx];
		if (tab) {
			tabQuery.value = tab.key;
		}
	},
});

const activeKey = computed(() => tabDefs.value[activeTabIndex.value]?.key);

// Mobile select mirrors the desktop tab strip; both drive `tabQuery`.
const tabSelectOptions = computed(() =>
	tabs.value.map((t) => ({ label: t.label, value: t.key })),
);
const activeTabKey = computed({
	get: () => activeKey.value,
	set: (key) => {
		if (key) tabQuery.value = key;
	},
});

// One list resource per tab, built lazily on first access. The resource `auto`
// flag is evaluated once at creation (not reactive), so fetching is driven
// explicitly by the watcher below rather than by `auto`.
const resources = {};

function entryFor(key) {
	const def = tabDefs.value.find((d) => d.key === key);
	if (!def) return null;
	if (!resources[key]) {
		resources[key] = createListResource({
			doctype: 'Wiki Change Request',
			fields: def.fields,
			filters: def.filters(),
			orderBy: 'modified desc',
			pageLength: 25,
			auto: false,
		});
	}
	return { def, resource: resources[key] };
}

// Lazy load: fetch a tab's list only the first time it becomes active, and
// re-apply its filter at fetch time so the current user is always fresh.
watch(
	activeKey,
	(key) => {
		const entry = key ? entryFor(key) : null;
		if (entry && !entry.resource.list.fetched) {
			entry.resource.update({ filters: entry.def.filters() });
			entry.resource.reload();
		}
	},
	{ immediate: true },
);

function panelFor(key) {
	const entry = entryFor(key) || entryFor(tabDefs.value[0].key);
	return { resource: entry.resource, columns: entry.def.columns, options: entry.def.options };
}

const showAssignDialog = ref(false);
const assignTarget = ref(null);

function openAssign(row) {
	assignTarget.value = row.name;
	showAssignDialog.value = true;
}

function onAssigned() {
	// Refresh only the inboxes that have actually been opened (and thus exist).
	resources['assigned']?.reload();
	resources['all']?.reload();
}
</script>
