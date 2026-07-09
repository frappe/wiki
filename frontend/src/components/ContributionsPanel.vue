<template>
	<div class="flex-1 overflow-auto px-3 pt-4 pb-4 sm:px-5 sm:pb-5">
		<div
			v-if="resource.list.loading && !resource.data?.length"
			class="flex items-center justify-center py-16"
		>
			<LoadingIndicator class="size-8" />
		</div>
		<template v-else>
			<!-- The List family owns geometry only; empty states are app-authored. -->
			<div
				v-if="!rows.length"
				class="flex flex-col items-center justify-center py-16 text-center"
			>
				<p class="text-lg-medium text-ink-gray-7">
					{{ options.emptyState?.title }}
				</p>
				<p class="mt-1 max-w-sm text-p-sm text-ink-gray-5">
					{{ options.emptyState?.description }}
				</p>
			</div>
			<template v-else>
				<!-- Keep the table a table on mobile; scroll it sideways (CRM pattern)
				     so the wider review columns stay readable. -->
				<div class="min-w-[720px] sm:min-w-0">
					<List :columns="tracks">
						<ListHeader>
							<ListHeaderCell
								v-for="col in columns"
								:key="col.key"
								:class="col.align === 'right' ? 'justify-end' : ''"
							>
								{{ col.label }}
							</ListHeaderCell>
						</ListHeader>
						<ListRows :items="rows" row-key="name" v-slot="{ item: row }">
							<ListRow :to="options.getRowRoute?.(row)">
								<ListCell
									v-for="col in columns"
									:key="col.key"
									:class="col.align === 'right' ? 'justify-end' : ''"
								>
									<Badge
										v-if="col.key === 'status'"
										variant="subtle"
										:theme="getStatusTheme(row.status)"
										size="sm"
									>
										{{ row.status }}
									</Badge>
									<div v-else-if="col.key === 'owner'" class="truncate text-ink-gray-6">
										{{ row.owner }}
									</div>
									<div
										v-else-if="col.key === 'modified'"
										class="flex items-center gap-1.5 text-sm text-ink-gray-5"
										:title="formatDateTime(row.modified)"
									>
										<span class="lucide-clock size-3.5 shrink-0 text-ink-gray-4" aria-hidden="true" />
										<span class="truncate">{{ formatDate(row.modified) }}</span>
									</div>
									<div
										v-else-if="col.key === 'assign'"
										class="flex items-center gap-2"
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
									<div v-else class="truncate" :title="row[col.key]">
										{{ row[col.key] }}
									</div>
								</ListCell>
							</ListRow>
						</ListRows>
					</List>
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
		</template>
	</div>
</template>

<script setup>
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';
import { Badge, Button, LoadingIndicator } from 'frappe-ui';
import {
	List,
	ListCell,
	ListHeader,
	ListHeaderCell,
	ListRow,
	ListRows,
} from 'frappe-ui/list';
import { computed } from 'vue';

const props = defineProps({
	resource: { type: Object, required: true },
	columns: { type: Array, required: true },
	options: { type: Object, required: true },
});

const emit = defineEmits(['assign']);

const rows = computed(() => props.resource.data || []);

// Column descriptors keep the old ListView shape (numeric width = fr weight,
// string width = fixed track); translate them into grid tracks for List.
const tracks = computed(() =>
	props.columns.map((col) =>
		typeof col.width === 'number' ? `minmax(0,${col.width}fr)` : col.width,
	),
);

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
