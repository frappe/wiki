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
							<div v-else-if="column.key === 'modified'" class="text-ink-gray-5 text-sm">
								{{ formatDate(row.modified) }}
							</div>
							<div v-else-if="column.key === 'assign'">
								<Button variant="ghost" size="sm" icon-left="user-plus" @click.stop="openAssign(row)">
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
import { computed, ref } from 'vue';
import { useRouteQuery } from '@vueuse/router';
import { ListView, Badge, Tabs, Button, LoadingIndicator, createListResource, usePageMeta } from 'frappe-ui';
import { useUserStore } from '@/stores/user';
import AssignDialog from '@/components/AssignDialog.vue';

usePageMeta(() => ({ title: `${__('Change Requests')} | Frappe Wiki` }));

const tabQuery = useRouteQuery('tab', 'my');
const userStore = useUserStore();
const isManager = computed(() => userStore.isWikiManager);

const activeTabIndex = computed({
	get() {
		const idx = tabs.value.findIndex(t => t.key === tabQuery.value);
		return idx >= 0 ? idx : 0;
	},
	set(idx) {
		const tab = tabs.value[idx];
		if (tab) {
			tabQuery.value = tab.key;
		}
	},
});

const tabs = computed(() => {
	const items = [
		{ key: 'my', label: __('My Change Requests') },
		{ key: 'assigned', label: __('Assigned to me') },
	];
	if (isManager.value) {
		items.push({ key: 'all', label: __('All in review') });
	}
	return items;
});

const myChangeRequests = createListResource({
	doctype: 'Wiki Change Request',
	fields: ['name', 'title', 'wiki_space.space_name', 'status', 'modified', 'archived_at', 'merged_at'],
	filters: { owner: ['=', userStore.user] },
	orderBy: 'modified desc',
	pageLength: 25,
	auto: true,
});

// Reviewer inbox driven by Frappe's native assignment (`_assign` / ToDo).
const assignedToMe = createListResource({
	doctype: 'Wiki Change Request',
	fields: ['name', 'title', 'wiki_space.space_name', 'status', 'owner', 'modified'],
	filters: { _assign: ['like', `%${userStore.user}%`], status: ['in', ['In Review', 'Approved']] },
	orderBy: 'modified desc',
	pageLength: 25,
	auto: true,
});

const allInReview = createListResource({
	doctype: 'Wiki Change Request',
	fields: ['name', 'title', 'wiki_space.space_name', 'status', 'owner', 'modified'],
	filters: { status: ['in', ['In Review', 'Approved']] },
	orderBy: 'modified desc',
	pageLength: 25,
	auto: computed(() => isManager.value),
});

const myChangeRequestColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Space'), key: 'space_name', width: 1.5 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Last Modified'), key: 'modified', width: 1.5 },
];

const reviewColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Author'), key: 'owner', width: 1.5 },
	{ label: __('Space'), key: 'space_name', width: 1.5 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Submitted'), key: 'modified', width: 1.5 },
	{ label: '', key: 'assign', width: 0.8, align: 'right' },
];

const reviewRowRoute = (row) => ({ name: 'ChangeRequestReview', params: { changeRequestId: row.name } });

const myChangeRequestOptions = {
	selectable: false,
	showTooltip: true,
	resizeColumn: false,
	getRowRoute: getRowRoute,
	emptyState: {
		title: __('No Change Requests'),
		description: __('You have not created any change requests yet. Edit a wiki page to get started.'),
	},
};

const assignedOptions = {
	selectable: false,
	showTooltip: true,
	resizeColumn: false,
	getRowRoute: reviewRowRoute,
	emptyState: {
		title: __('Nothing assigned to you'),
		description: __('Change requests assigned to you for review will appear here.'),
	},
};

const allOptions = {
	selectable: false,
	showTooltip: true,
	resizeColumn: false,
	getRowRoute: reviewRowRoute,
	emptyState: {
		title: __('No change requests in review'),
		description: __('There are no change requests waiting for review.'),
	},
};

function panelFor(key) {
	if (key === 'assigned') {
		return { resource: assignedToMe, columns: reviewColumns, options: assignedOptions };
	}
	if (key === 'all') {
		return { resource: allInReview, columns: reviewColumns, options: allOptions };
	}
	return { resource: myChangeRequests, columns: myChangeRequestColumns, options: myChangeRequestOptions };
}

const showAssignDialog = ref(false);
const assignTarget = ref(null);

function openAssign(row) {
	assignTarget.value = row.name;
	showAssignDialog.value = true;
}

function onAssigned() {
	assignedToMe.reload();
	if (isManager.value) allInReview.reload();
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

function getRowRoute(row) {
	if (row.status === 'Draft' || row.status === 'Changes Requested') {
		return { name: 'SpaceDetails', params: { spaceId: row.wiki_space } };
	}
	return { name: 'ChangeRequestReview', params: { changeRequestId: row.name } };
}

function formatDate(dateStr) {
	if (!dateStr) return '';
	const date = new Date(dateStr);
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
</script>
