<template>
	<div class="flex h-full min-h-0 flex-col">
		<!-- Header: fixed 48px region so its bottom border lines up with the
		     main column's banner/header bars. -->
		<div class="flex h-12 shrink-0 items-center gap-1 border-b border-outline-gray-2 px-2">
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

		<WikiTabBar
			v-if="spaceLoaded && treeData"
			:tabs="tabs"
			:active-key="activeTabKey"
			@select="selectTab"
		/>

		<div v-if="spaceLoaded && treeData" class="flex-1 overflow-auto px-2 pt-2 pb-10">
			<WikiDocumentList
				:tree-data="visibleTreeData"
				:change-type-map="changeTypeMap"
				:space-id="spaceId"
				:readonly="readonly"
				:root-node="visibleTreeData.root_group || ''"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
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
import { computed, ref, watch } from 'vue';

import {
	buildTabList,
	findOwningTabKey,
	subtreeForTab,
} from '../lib/spaceTabs.js';
import WikiDocumentList from './WikiDocumentList.vue';
import WikiTabBar from './WikiTabBar.vue';

const props = defineProps({
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

const topLevelNodes = computed(() => props.treeData?.children || []);
const tabs = computed(() => buildTabList(topLevelNodes.value, __('General')));

// The tab owning the currently open page, per the spec's rule: walk the page's
// ancestors up to the tab-flagged group.
const selectedTabKey = computed(() => {
	if (!tabs.value.length) return null;
	if (!props.selectedPageId && !props.selectedDraftKey) return null;
	return findOwningTabKey(
		topLevelNodes.value,
		(node) =>
			(props.selectedDraftKey && node.doc_key === props.selectedDraftKey) ||
			(props.selectedPageId && node.document_name === props.selectedPageId),
	);
});

// Single source of truth so the most recent action wins: clicking a tab browses
// it even while a page from another tab is still open, and navigating to a page
// pulls the bar back to that page's tab.
const activeTabKey = ref(null);

watch(
	[tabs, selectedTabKey],
	([tabList, owningKey]) => {
		if (!tabList.length) {
			activeTabKey.value = null;
			return;
		}
		const stillValid = tabList.some((tab) => tab.key === activeTabKey.value);
		if (owningKey) activeTabKey.value = owningKey;
		else if (!stillValid) activeTabKey.value = tabList[0].key;
	},
	{ immediate: true, deep: true },
);

const visibleTreeData = computed(() => {
	if (!props.treeData) return { children: [], root_group: '' };
	if (!tabs.value.length) return props.treeData;

	const { children, rootNode } = subtreeForTab(
		topLevelNodes.value,
		activeTabKey.value,
		props.treeData.root_group || '',
	);
	return { ...props.treeData, children, root_group: rootNode };
});

function selectTab(key) {
	activeTabKey.value = key;
}
</script>
