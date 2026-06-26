<template>
	<div class="flex h-full min-h-0 flex-col">
		<!-- Header -->
		<div class="p-4 border-b border-outline-gray-2">
			<div class="flex items-center justify-between mb-3">
				<Button
					variant="ghost"
					icon-left="arrow-left"
					:route="{ name: 'SpaceList' }"
				>
					{{ __('Back to Spaces') }}
				</Button>
				<Button
					variant="ghost"
					icon="settings"
					:title="__('Settings')"
					@click="emit('open-settings')"
				/>
			</div>
			<div class="flex items-center gap-2">
				<h1 class="text-lg font-semibold text-ink-gray-9">
					{{ spaceName || spaceId }}
				</h1>
				<Button
					v-if="spaceRoute"
					variant="ghost"
					icon="external-link"
					:title="__('View Space')"
					:link="'/' + spaceRoute"
				/>
			</div>
			<p class="text-sm text-ink-gray-5 mt-0.5">{{ spaceRoute }}</p>
		</div>

		<div v-if="spaceLoaded && treeData" class="flex-1 overflow-auto p-2">
			<WikiDocumentList
				:tree-data="treeData"
				:change-type-map="changeTypeMap"
				:space-id="spaceId"
				:readonly="readonly"
				:root-node="treeData.root_group || ''"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				@refresh="emit('refresh')"
				@reorder-state-change="emit('reorder-state-change', $event)"
			/>
		</div>
		<div v-else class="flex-1 overflow-auto p-2">
			<!-- Sidebar tree skeleton -->
			<div class="space-y-1 animate-pulse">
				<div
					v-for="i in 8"
					:key="i"
					class="flex items-center gap-2 px-2 py-1.5 rounded"
				>
					<div class="size-4 rounded bg-surface-gray-3 shrink-0" />
					<div
						class="h-3.5 rounded bg-surface-gray-3"
						:style="{ width: `${60 + (i % 3) * 25}%` }"
					/>
				</div>
				<div
					v-for="i in 4"
					:key="'nested-' + i"
					class="flex items-center gap-2 px-2 py-1.5 rounded ml-6"
				>
					<div class="size-4 rounded bg-surface-gray-3 shrink-0" />
					<div
						class="h-3.5 rounded bg-surface-gray-3"
						:style="{ width: `${50 + (i % 2) * 30}%` }"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Button } from 'frappe-ui';
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
});

const emit = defineEmits(['refresh', 'reorder-state-change', 'open-settings']);
</script>
