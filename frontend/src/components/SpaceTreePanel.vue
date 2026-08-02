<template>
	<div class="flex h-full min-h-0 flex-col">
		<!-- Header: fixed 48px region so its bottom border lines up with the
		     main column's banner/header bars. -->
		<div
			v-if="!compactHeader"
			class="flex h-12 shrink-0 items-center gap-1 border-b border-outline-gray-2 px-2"
		>
			<Button
				variant="ghost"
				icon="arrow-left"
				:title="__('Back to Spaces')"
				:route="{ name: 'SpaceList' }"
			/>
			<div class="min-w-0 flex-1">
				<div class="truncate text-base-medium leading-none text-ink-gray-8">
					{{ spaceName || spaceId }}
				</div>
				<div class="mt-0.5 truncate text-sm leading-none text-ink-gray-6">
					{{ spaceRoute }}
				</div>
			</div>
			<Button
				v-if="spaceRoute"
				variant="ghost"
				icon="external-link"
				:title="__('View Space')"
				:link="'/' + spaceRoute"
			/>
			<Button
				variant="ghost"
				icon="settings"
				:title="__('Settings')"
				@click="emit('open-settings')"
			/>
		</div>

		<div v-if="spaceLoaded && treeData" class="flex-1 overflow-auto px-2 pt-2 pb-10">
			<WikiDocumentList
				:tree-data="treeData"
				:change-type-map="changeTypeMap"
				:space-id="spaceId"
				:readonly="readonly"
				:root-node="treeData.root_group || ''"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				:can-manage-tabs="canManageTabs"
				:space-root-node="spaceRootNode"
				:space-route="spaceRoute"
				@refresh="emit('refresh')"
				@reorder-state-change="emit('reorder-state-change', $event)"
			/>
		</div>
		<div v-else class="flex-1 overflow-auto p-2">
			<!-- Sidebar tree skeleton -->
			<div class="space-y-1">
				<div
					v-for="i in 8"
					:key="i"
					class="flex items-center gap-2 px-2 py-1.5 rounded"
				>
					<Skeleton class="size-4 rounded shrink-0" />
					<Skeleton
						class="h-3.5 rounded"
						:style="{ width: `${60 + (i % 3) * 25}%` }"
					/>
				</div>
				<div
					v-for="i in 4"
					:key="'nested-' + i"
					class="flex items-center gap-2 px-2 py-1.5 rounded ml-6"
				>
					<Skeleton class="size-4 rounded shrink-0" />
					<Skeleton
						class="h-3.5 rounded"
						:style="{ width: `${50 + (i % 2) * 30}%` }"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Button, Skeleton } from 'frappe-ui';

import WikiDocumentList from './WikiDocumentList.vue';

defineProps({
	spaceId: { type: String, required: true },
	spaceName: { type: String, default: '' },
	spaceRoute: { type: String, default: '' },
	spaceLoaded: { type: Boolean, default: false },
	// Already narrowed to the active tab's subtree by useSpaceTabs; `root_group`
	// is that tab, so top-level drops reparent into it.
	treeData: { type: Object, default: null },
	changeTypeMap: { type: Map, default: () => new Map() },
	readonly: { type: Boolean, default: false },
	selectedPageId: { type: String, default: null },
	selectedDraftKey: { type: String, default: null },
	canManageTabs: { type: Boolean, default: false },
	// The space root, where a new tab must be parented regardless of which tab
	// is currently being browsed.
	spaceRootNode: { type: String, default: '' },
	compactHeader: { type: Boolean, default: false },
});

const emit = defineEmits(['refresh', 'reorder-state-change', 'open-settings']);
</script>
