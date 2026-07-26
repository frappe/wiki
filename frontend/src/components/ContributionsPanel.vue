<template>
	<div class="flex-1 overflow-auto px-3 pt-4 pb-4 sm:px-5 sm:pb-5">
		<!-- First load: skeleton rows in the real List chrome, so the table's
		     columns and row height don't shift when the data lands. -->
		<div
			v-if="resource.list.loading && !resource.data?.length"
			class="min-w-[720px] sm:min-w-0"
		>
			<List :columns="tracks" :row-height="40">
				<ListHeader>
					<ListHeaderCell
						v-for="col in columns"
						:key="col.key"
						:class="col.align === 'right' ? 'justify-end' : ''"
					>
						{{ col.label }}
					</ListHeaderCell>
				</ListHeader>
				<ListRow v-for="i in SKELETON_ROWS" :key="i">
					<ListCell
						v-for="col in columns"
						:key="col.key"
						:class="col.align === 'right' ? 'justify-end' : ''"
					>
						<Skeleton
							class="h-4 rounded"
							:class="skeletonWidth(col)"
							:style="{ animationDelay: `${i * 60}ms` }"
						/>
					</ListCell>
				</ListRow>
			</List>
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
				<!-- Keep the table a table on mobile; scroll it sideways so the
				     wider review columns stay readable. -->
				<div class="min-w-[720px] sm:min-w-0">
					<List :columns="tracks" :row-height="40">
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
									<!-- Cells don't inherit an ink color from the List family, so an
									     explicit token is required or the text goes black in dark mode. -->
									<div
										v-else
										class="truncate"
										:class="col.key === 'title' ? 'text-ink-gray-9' : 'text-ink-gray-7'"
										:title="row[col.key]"
									>
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
import { Badge, Button, Skeleton } from 'frappe-ui';
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

const SKELETON_ROWS = 6;

// Placeholder bars are sized per column kind so the loading table reads like
// the real one rather than a block of identical grey lines.
function skeletonWidth(col) {
	switch (col.key) {
		case 'title':
			return 'w-3/4';
		case 'status':
			return 'w-16';
		case 'assign':
			return 'w-20';
		case 'modified':
			return 'w-24';
		default:
			return 'w-1/2';
	}
}

// Numeric width = fr weight, string width = fixed track.
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
