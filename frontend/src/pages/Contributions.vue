<template>
	<div class="flex flex-col gap-4 p-4">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</div>

		<Tabs v-model="activeTabIndex" :tabs="tabs">
			<template #tab-panel="{ tab }">
				<div v-if="tab.key === 'my'" class="pt-4">
					<ListView
						class="h-[calc(100vh-280px)]"
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
							<div v-else-if="column.key === 'change_count'" class="text-ink-gray-6">
								{{ row.change_count }} {{ row.change_count === 1 ? __('change') : __('changes') }}
							</div>
							<div v-else-if="column.key === 'modified'" class="text-ink-gray-5 text-sm">
								{{ formatDate(row.modified) }}
							</div>
							<div v-else>
								{{ row[column.key] }}
							</div>
						</template>
					</ListView>
				</div>

				<div v-else-if="tab.key === 'reviews'" class="pt-4">
					<ListView
						class="h-[calc(100vh-280px)]"
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
							<div v-else-if="column.key === 'author_name'" class="flex items-center gap-2">
								<Avatar :image="row.author_image" :label="row.author_name" size="sm" />
								<span>{{ row.author_name }}</span>
							</div>
							<div v-else-if="column.key === 'change_count'" class="text-ink-gray-6">
								{{ row.change_count }} {{ row.change_count === 1 ? __('change') : __('changes') }}
							</div>
							<div v-else-if="column.key === 'submitted_at'" class="text-ink-gray-5 text-sm">
								{{ formatDate(row.submitted_at) }}
							</div>
							<div v-else>
								{{ row[column.key] }}
							</div>
						</template>
					</ListView>
				</div>
			</template>
		</Tabs>
	</div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ListView, Badge, Avatar, Tabs, createResource } from 'frappe-ui';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const isManager = computed(() => userStore.isWikiManager);
const activeTabIndex = ref(0);

const tabs = computed(() => {
	const items = [
		{ key: 'my', label: __('My Change Requests') },
	];
	if (isManager.value) {
		items.push({ key: 'reviews', label: __('Pending Reviews') });
	}
	return items;
});

const myChangeRequests = createResource({
	url: 'wiki.api.change_requests.get_my_change_requests',
	auto: true,
});

const pendingReviews = createResource({
	url: 'wiki.api.change_requests.get_pending_reviews',
	auto: computed(() => isManager.value),
});

const myChangeRequestColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Space'), key: 'wiki_space_name', width: 1.5 },
	{ label: __('Changes'), key: 'change_count', width: 1 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Last Modified'), key: 'modified', width: 1.5 },
];

const reviewsColumns = [
	{ label: __('Title'), key: 'title', width: 2 },
	{ label: __('Author'), key: 'author_name', width: 1.5 },
	{ label: __('Space'), key: 'wiki_space_name', width: 1.5 },
	{ label: __('Changes'), key: 'change_count', width: 1 },
	{ label: __('Status'), key: 'status', width: 1 },
	{ label: __('Submitted'), key: 'submitted_at', width: 1.5 },
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
