<template>
	<div class="flex flex-col gap-4 p-4 h-full overflow-hidden">
		<div class="flex items-center justify-between shrink-0">
			<h2 class="text-xl font-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</div>

		<Tabs v-model="activeTabIndex" :tabs="tabs">
			<template #tab-panel="{ tab }">
				<template v-if="tab.key === 'my'">
					<div v-if="myChangeRequests.list.loading && !myChangeRequests.data?.length" class="flex items-center justify-center flex-1">
						<LoadingIndicator class="size-8" />
					</div>
					<div v-else class="flex-1 overflow-auto">
						<ListView
							:columns="myChangeRequestColumns"
							:rows="myChangeRequests.data || []"
							:options="myChangeRequestOptions"
							row-key="name"
						>
							<template #cell="{ column, row }">
								<div v-if="column.key === 'status'">
									<Badge :variant="'subtle'" :theme="getStatusTheme(row.status)" size="sm">
										{{ row.status }}
									</Badge>
								</div>
								<div v-else-if="column.key === 'modified'" class="text-ink-gray-5 text-sm">
									{{ formatDate(row.modified) }}
								</div>
								<div v-else>
									{{ row[column.key] }}
								</div>
							</template>
						</ListView>

						<div v-if="myChangeRequests.hasNextPage" class="flex px-2 py-2">
							<Button
								@click="() => myChangeRequests.next()"
								:loading="myChangeRequests.list.loading"
								:label="__('Load more')"
								icon-left="refresh-cw"
							/>
						</div>
					</div>
				</template>

				<template v-else-if="tab.key === 'reviews'">
					<div v-if="pendingReviews.list.loading && !pendingReviews.data?.length" class="flex items-center justify-center flex-1">
						<LoadingIndicator class="size-8" />
					</div>
					<div v-else class="flex-1 overflow-auto">
						<ListView
							:columns="reviewsColumns"
							:rows="pendingReviews.data || []"
							:options="reviewsOptions"
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
								<div v-else>
									{{ row[column.key] }}
								</div>
							</template>
						</ListView>

						<div v-if="pendingReviews.hasNextPage" class="flex px-2 py-2">
							<Button
								@click="() => pendingReviews.next()"
								:loading="pendingReviews.list.loading"
								:label="__('Load more')"
								icon-left="refresh-cw"
							/>
						</div>
					</div>
				</template>
			</template>
		</Tabs>
	</div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouteQuery } from '@vueuse/router';
import { ListView, Badge, Tabs, Button, LoadingIndicator, createListResource } from 'frappe-ui';
import { useUserStore } from '@/stores/user';

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
	];
	if (isManager.value) {
		items.push({ key: 'reviews', label: __('Pending Reviews') });
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

const pendingReviews = createListResource({
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

const reviewsColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Author'), key: 'owner', width: 1.5 },
	{ label: __('Space'), key: 'space_name', width: 1.5 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Submitted'), key: 'modified', width: 1.5 },
];

function getStatusTheme(status) {
	switch (status) {
		case 'Draft': return 'blue';
		case 'In Review': return 'orange';
		case 'Changes Requested': return 'red';
		case 'Approved': return 'green';
		case 'Merged': return 'green';
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

const reviewsOptions = {
	selectable: false,
	showTooltip: true,
	resizeColumn: false,
	getRowRoute: (row) => ({ name: 'ChangeRequestReview', params: { changeRequestId: row.name } }),
	emptyState: {
		title: __('No Pending Reviews'),
		description: __('There are no change requests waiting for review.'),
	},
};
</script>
