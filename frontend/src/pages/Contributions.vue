<template>
	<div class="flex flex-col h-full overflow-hidden">
		<div class="flex items-center justify-between shrink-0 px-5 pt-5 pb-3">
			<h2 class="text-xl font-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</div>

		<Tabs v-model="activeTabIndex" :tabs="tabs">
			<template #tab-panel="{ tab }">
				<div v-if="panelFor(tab.key).resource.list.loading && !panelFor(tab.key).resource.data?.length" class="flex items-center justify-center flex-1 py-16">
					<LoadingIndicator class="size-8" />
				</div>
				<div v-else class="flex-1 overflow-auto px-5 pt-4 pb-5">
					<ListView
						:columns="panelFor(tab.key).columns"
						:rows="panelFor(tab.key).resource.data || []"
						:options="panelFor(tab.key).options"
						row-key="name"
					>
						<template #cell="{ column, row }">
							<div v-if="column.key === 'status'">
								<Badge :variant="'subtle'" :theme="getStatusTheme(row.status)" size="sm">
									{{ row.status }}
								</Badge>
							</div>
							<div v-else-if="column.key === 'owner'" class="text-ink-gray-6">
								{{ row.owner }}
							</div>
							<div
								v-else-if="column.key === 'modified'"
								class="flex items-center gap-1.5 text-ink-gray-5 text-sm"
								:class="{ 'justify-end': column.align === 'right' }"
								:title="formatDateTime(row.modified)"
							>
								<FeatherIcon name="clock" class="size-3.5 shrink-0 text-ink-gray-4" />
								<span class="truncate">{{ formatDate(row.modified) }}</span>
							</div>
							<div v-else-if="column.key === 'assign'" class="flex items-center justify-end gap-2">
								<AssigneeAvatars v-if="row._assign" :assign="row._assign" />
								<!-- Rows are router-links (an <a>); .stop alone halts JS bubbling but
								     the browser still follows the anchor href, so .prevent is required
								     to keep the Assign click from navigating to the CR. -->
								<Button variant="ghost" size="sm" icon-left="user-plus" @click.stop.prevent="openAssign(row)">
									{{ __('Assign') }}
								</Button>
							</div>
							<div v-else>
								{{ row[column.key] }}
							</div>
						</template>
					</ListView>

					<div v-if="panelFor(tab.key).resource.hasNextPage" class="flex pt-3">
						<Button
							@click="() => panelFor(tab.key).resource.next()"
							:loading="panelFor(tab.key).resource.list.loading"
							:label="__('Load more')"
							icon-left="refresh-cw"
						/>
					</div>
				</div>
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
import { ListView, Badge, Tabs, Button, FeatherIcon, LoadingIndicator, createListResource, usePageMeta } from 'frappe-ui';
import { useUserStore } from '@/stores/user';
import AssignDialog from '@/components/AssignDialog.vue';
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';

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

function getStatusTheme(status) {
	switch (status) {
		case 'Draft': return 'blue';
		case 'In Review': return 'orange';
		case 'Changes Requested': return 'red';
		case 'Approved': return 'green';
		case 'Merged': return 'green';
		case 'Rejected': return 'red';
		case 'Archived': return 'gray';
		default: return 'gray';
	}
}

function formatDate(dateStr) {
	if (!dateStr) return '';
	return new Date(dateStr).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function formatDateTime(dateStr) {
	if (!dateStr) return '';
	return new Date(dateStr).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
</script>
