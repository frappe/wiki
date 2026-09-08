<template>
	<div class="flex h-full min-h-0 flex-col">
		<!-- Header: fixed 48px region so its bottom border lines up with the
		     main column's banner/header bars. -->
		<div
			v-if="!compactHeader"
			class="flex h-12 shrink-0 items-center gap-1 border-b border-outline-gray-2 px-2"
		>
			<Tooltip :text="__('Back to Overview')">
				<Button
					variant="ghost"
					icon="lucide-arrow-left"
					:aria-label="__('Back to Overview')"
					:route="{ name: 'Overview' }"
				/>
			</Tooltip>
			<div class="min-w-0 flex-1">
				<div class="truncate text-base-medium leading-none text-ink-gray-8">
					{{ spaceName || spaceId }}
				</div>
				<div class="mt-0.5 truncate text-sm leading-none text-ink-gray-6">
					{{ spaceRoute }}
				</div>
			</div>
			<Tooltip :text="__('View space')">
				<Button
					v-if="spaceRoute"
					variant="ghost"
					icon="lucide-external-link"
					:aria-label="__('View space')"
					:link="'/' + spaceRoute"
				/>
			</Tooltip>
			<Tooltip :text="__('Space settings')">
				<Button
					variant="ghost"
					icon="lucide-settings"
					:aria-label="__('Space settings')"
					@click="emit('open-settings')"
				/>
			</Tooltip>
		</div>

		<!-- The list owns the scroller: its search row and New page footer have
		     to stay put while the tree between them scrolls. -->
		<div v-if="spaceLoaded && treeData" class="flex min-h-0 flex-1 flex-col pt-2">
			<WikiDocumentList
				class="min-h-0 flex-1"
				:tree-data="treeData"
				:change-type-map="changeTypeMap"
				:space-id="spaceId"
				:readonly="readonly"
				:root-node="treeData.root_group || ''"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				:space-route="spaceRoute"
				@refresh="emit('refresh')"
				@reorder-state-change="emit('reorder-state-change', $event)"
			>
				<template v-if="$slots['above-footer']" #above-footer>
					<slot name="above-footer" />
				</template>
			</WikiDocumentList>
		</div>
		<div v-else class="flex-1 overflow-auto p-2">
			<!-- Sidebar tree skeleton -->
			<div class="space-y-1">
				<div
					v-for="i in 8"
					:key="i"
					class="flex items-center gap-2 px-2 py-1.5 rounded-4"
				>
					<Skeleton class="size-4 rounded-4 shrink-0" />
					<Skeleton
						class="h-3.5 rounded-4"
						:style="{ width: `${60 + (i % 3) * 25}%` }"
					/>
				</div>
				<div
					v-for="i in 4"
					:key="'nested-' + i"
					class="flex items-center gap-2 px-2 py-1.5 rounded-4 ml-6"
				>
					<Skeleton class="size-4 rounded-4 shrink-0" />
					<Skeleton
						class="h-3.5 rounded-4"
						:style="{ width: `${50 + (i % 2) * 30}%` }"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Button, Skeleton, Tooltip } from 'frappe-ui';

import WikiDocumentList from './WikiDocumentList.vue';

defineProps({
	spaceId: { type: String, required: true },
	spaceName: { type: String, default: '' },
	spaceRoute: { type: String, default: '' },
	spaceLoaded: { type: Boolean, default: false },
	treeData: { type: Object, default: null },
	changeTypeMap: { type: Map, default: () => new Map() },
	readonly: { type: Boolean, default: false },
	selectedPageId: { type: String, default: null },
	selectedDraftKey: { type: String, default: null },
	compactHeader: { type: Boolean, default: false },
});

const emit = defineEmits(['refresh', 'reorder-state-change', 'open-settings']);
</script>
