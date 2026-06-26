<template>
	<div class="flex-1 overflow-auto px-3 pt-4 pb-4 sm:px-5 sm:pb-5">
		<div
			v-if="resource.list.loading && !resource.data?.length"
			class="flex items-center justify-center py-16"
		>
			<LoadingIndicator class="size-8" />
		</div>
		<template v-else>
			<!-- Keep the table a table on mobile; scroll it sideways (CRM pattern)
			     so the wider review columns stay readable. -->
			<div class="min-w-[720px] sm:min-w-0">
				<ListView
					:columns="columns"
					:rows="resource.data || []"
					:options="options"
					row-key="name"
				>
					<template #cell="{ column, row }">
						<div v-if="column.key === 'status'">
							<Badge variant="subtle" :theme="getStatusTheme(row.status)" size="sm">
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
						<div
							v-else-if="column.key === 'assign'"
							class="flex items-center justify-end gap-2"
						>
							<AssigneeAvatars v-if="row._assign" :assign="row._assign" />
							<!-- Rows are router-links (an <a>); .stop halts JS bubbling but the
							     browser still follows the anchor href, so .prevent is required
							     to keep the Assign click from navigating to the CR. -->
							<Button
								variant="ghost"
								size="sm"
								icon-left="user-plus"
								@click.stop.prevent="emit('assign', row)"
							>
								{{ __('Assign') }}
							</Button>
						</div>
						<div v-else>
							{{ row[column.key] }}
						</div>
					</template>
				</ListView>
			</div>

			<div v-if="resource.hasNextPage" class="flex pt-3">
				<Button
					@click="() => resource.next()"
					:loading="resource.list.loading"
					:label="__('Load more')"
					icon-left="refresh-cw"
				/>
			</div>
		</template>
	</div>
</template>

<script setup>
import { Badge, Button, FeatherIcon, ListView, LoadingIndicator } from 'frappe-ui';
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';

defineProps({
	resource: { type: Object, required: true },
	columns: { type: Array, required: true },
	options: { type: Object, required: true },
});

const emit = defineEmits(['assign']);

function getStatusTheme(status) {
	switch (status) {
		case 'Draft':
			return 'blue';
		case 'In Review':
			return 'orange';
		case 'Changes Requested':
			return 'red';
		case 'Approved':
			return 'green';
		case 'Merged':
			return 'green';
		case 'Rejected':
			return 'red';
		case 'Archived':
			return 'gray';
		default:
			return 'gray';
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
