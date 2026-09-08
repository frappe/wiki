<template>
	<div class="flex-1 overflow-auto px-3 pt-4 pb-4 sm:px-5 sm:pb-5">
		<!-- The List family owns geometry only; empty states are app-authored. -->
		<div
			v-if="!isFirstLoad && !rows.length"
			class="flex flex-col items-center justify-center py-16 text-center"
		>
			<p class="text-lg-medium text-ink-gray-7">
				{{ options.emptyState?.title }}
			</p>
			<p class="mt-1 max-w-sm text-p-sm text-ink-gray-5">
				{{ options.emptyState?.description }}
			</p>
		</div>

		<!-- One List spans both states: cold-load skeletons render inside the real
		     chrome, so the track list is declared once and columns can't shift when
		     the data lands. `list-row-px-3` sets the content inset on the List so
		     the header, the rows, and the space headings between them all share it
		     instead of drifting.
		     Mobile collapses the table to a feed via a --list-columns override
		     rather than scrolling sideways -- the track count here must stay in
		     step with the columns that declare `mobile`. -->
		<List
			v-else
			:columns="tracks"
			:row-height="60"
			class="w-full list-row-px-3 max-sm:list-cols-[minmax(0,1fr)_auto]"
		>
			<!-- `!hidden`: the family sets `display: grid` at attribute specificity
			     (to survive preflight resets), which a plain `hidden` utility ties
			     with and loses to on order. -->
			<ListHeader class="max-sm:!hidden">
				<ListHeaderCell
					v-for="col in columns"
					:key="col.key"
					:class="headerCellClass(col)"
				>
					{{ col.label }}
				</ListHeaderCell>
			</ListHeader>

			<template v-if="isFirstLoad">
				<ListRow v-for="i in SKELETON_ROWS" :key="i">
					<ListCell
						v-for="col in columns"
						:key="col.key"
						:class="cellClass(col)"
					>
						<div v-if="col.key === 'title'" class="min-w-0 flex-1">
							<Skeleton
								class="h-4 w-3/5 rounded-4"
								:style="{ animationDelay: `${i * 60}ms` }"
							/>
							<Skeleton
								class="mt-1.5 h-3 w-1/4 rounded-4"
								:style="{ animationDelay: `${i * 60}ms` }"
							/>
						</div>
						<Skeleton
							v-else
							class="h-4 rounded-4"
							:class="skeletonWidth(col)"
							:style="{ animationDelay: `${i * 60}ms` }"
						/>
					</ListCell>
				</ListRow>
			</template>

			<!-- Grouped by space, in order of first appearance. The resource is
			     ordered `modified desc`, so that puts the space with the newest
			     activity first, and a "Load more" page can only extend a group or
			     append a new one below -- never reshuffle the groups already read. -->
			<ListGroup
				v-for="group in groups"
				v-else
				:key="group.id"
				class="pt-2 first:pt-0"
				sticky
			>
				<template #header>
					<div class="flex min-w-0 items-center gap-2">
						<SpaceAvatar :space="group.space" :label="group.label" size="xs" />
						<span class="truncate text-sm-medium text-ink-gray-7">
							{{ group.label }}
						</span>
						<span class="shrink-0 text-sm text-ink-gray-4">
							{{ group.rows.length }}
						</span>
					</div>
				</template>

				<ListRow
					v-for="row in group.rows"
					:key="row.name"
					:to="options.getRowRoute?.(row)"
				>
					<ListCell
						v-for="col in columns"
						:key="col.key"
						:class="cellClass(col)"
					>
						<!-- The two-row cell: what the row is, then who it belongs to.
						     Both lines truncate on their own, so a long title never
						     pushes the author out of the column. -->
						<div v-if="col.key === 'title'" class="min-w-0 flex-1">
							<div class="truncate text-base text-ink-gray-8">
								{{ row.title }}
							</div>
							<div class="mt-1.5 truncate text-sm text-ink-gray-5">
								{{ row.owner }}
							</div>
						</div>

						<Badge
							v-else-if="col.key === 'status'"
							variant="subtle"
							:theme="getStatusTheme(row.status)"
							size="sm"
						>
							{{ row.status }}
						</Badge>

						<div
							v-else-if="col.key === 'assign'"
							class="flex min-w-0 items-center gap-2"
						>
							<AssigneeAvatars v-if="row._assign" :assign="row._assign" />
							<!-- Rows are router-links (an <a>); .stop halts JS bubbling but
							     the browser still follows the anchor href, so .prevent is
							     required to keep the Assign click from navigating to the CR. -->
							<Button
								variant="ghost"
								size="sm"
								icon-left="lucide-user-plus"
								@click.stop.prevent="emit('assign', row)"
							>
								{{ __('Assign') }}
							</Button>
						</div>

						<div
							v-else-if="col.key === 'modified'"
							class="truncate text-sm text-ink-gray-5"
							:title="formatDateTime(row.modified)"
						>
							{{ fromNow(row.modified) }}
						</div>
					</ListCell>
				</ListRow>
			</ListGroup>
		</List>

		<div v-if="resource.hasNextPage" class="flex pt-3">
			<Button
				@click="() => resource.next()"
				:loading="resource.list.loading"
				:label="__('Load more')"
				icon-left="lucide-refresh-cw"
			/>
		</div>
	</div>
</template>

<script setup>
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';
import SpaceAvatar from '@/components/SpaceAvatar.vue';
import { Badge, Button, Skeleton, dayjsLocal } from 'frappe-ui';
import {
	List,
	ListCell,
	ListGroup,
	ListHeader,
	ListHeaderCell,
	ListRow,
} from 'frappe-ui/list';
import { computed } from 'vue';

const props = defineProps({
	resource: { type: Object, required: true },
	options: { type: Object, required: true },
	// Reviewers can reassign; an author looking at their own drafts cannot, so
	// that tab drops the whole column rather than showing an empty one.
	showAssign: { type: Boolean, default: false },
});

const emit = defineEmits(['assign']);

const rows = computed(() => props.resource.data || []);

const SKELETON_ROWS = 6;

// `mobile` marks the two columns that survive the feed collapse, in order: the
// subject grows, the status badge trails. Changing that set means editing the
// max-sm track list on the List to match.
const columns = computed(() => [
	{ key: 'title', label: __('Subject'), track: 'minmax(0,1fr)', mobile: true },
	{ key: 'status', label: __('Status'), track: '7rem', mobile: true },
	...(props.showAssign
		? [{ key: 'assign', label: __('Assigned to'), track: '10rem' }]
		: []),
	{
		key: 'modified',
		label: __('Modified'),
		track: '6.5rem',
		align: 'right',
	},
]);

const tracks = computed(() => columns.value.map((col) => col.track));

function headerCellClass(col) {
	return col.align === 'right' ? 'justify-end' : '';
}

function cellClass(col) {
	return [
		col.align === 'right' ? 'justify-end' : '',
		col.mobile ? '' : 'max-sm:hidden',
	];
}

// Placeholder bars are sized per column kind so the loading table reads like
// the real one rather than a block of identical grey lines.
function skeletonWidth(col) {
	switch (col.key) {
		case 'status':
			return 'w-16';
		case 'assign':
			return 'w-20';
		case 'modified':
			return 'w-14';
		default:
			return 'w-1/2';
	}
}

// Cold load only: once a page has landed, refetches keep the rows on screen
// instead of flashing back to skeletons.
const isFirstLoad = computed(
	() => props.resource.list.loading && !props.resource.data?.length,
);

// `name` has to be the space docname, not the change request's: it is the seed
// resolveSpaceIdentity hashes a colour from, so anything else would give a
// space a different tint here than in the sidebar.
function spaceOf(row) {
	return {
		name: row.wiki_space,
		space_name: row.space_name,
		space_icon: row.space_icon,
		space_color: row.space_color,
		avatar: row.avatar,
		app_switcher_logo: row.app_switcher_logo,
	};
}

// A Map, so insertion order is the group order and re-grouping a grown list
// leaves the groups already on screen where the reader last saw them.
const groups = computed(() => {
	const byId = new Map();
	for (const row of rows.value) {
		const id = row.wiki_space || '';
		let group = byId.get(id);
		if (!group) {
			group = {
				id,
				label: row.space_name || __('No Space'),
				space: spaceOf(row),
				rows: [],
			};
			byId.set(id, group);
		}
		group.rows.push(row);
	}
	return [...byId.values()];
});

function getStatusTheme(status) {
	switch (status) {
		case 'Draft':
			return 'blue';
		case 'In Review':
			return 'amber';
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

function fromNow(dateStr) {
	return dateStr ? dayjsLocal(dateStr).fromNow() : '';
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
