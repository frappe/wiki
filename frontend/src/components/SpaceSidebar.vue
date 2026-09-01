<template>
	<!-- Level 1 of the drill-in model: the sidebar becomes the space. Fixed
	     width and no collapse toggle — the tree is the navigation here, so
	     collapsing it would leave the space with no way around.

	     `aside` is what this region is; `contents` keeps the wrapper out of the
	     shell's flex row so Sidebar still sizes itself. -->
	<aside class="contents">
		<Sidebar width="260px" disable-collapse>
			<div
				class="flex h-12 shrink-0 items-center gap-1.5 border-b border-outline-gray-2 px-2"
			>
				<Button
					variant="ghost"
					icon="lucide-chevron-left"
					:title="__('Back to Overview')"
					:route="{ name: 'Overview' }"
				/>
				<Avatar
					size="sm"
					shape="square"
					:image="spaceStore.doc?.app_switcher_logo"
					:label="spaceName"
				/>
				<span class="min-w-0 flex-1 truncate text-base-medium text-ink-gray-8">
					{{ spaceName }}
				</span>
				<Dropdown :options="spaceActions" placement="right">
					<Button
						variant="ghost"
						icon="lucide-more-horizontal"
						:title="__('Space actions')"
					/>
				</Dropdown>
			</div>

			<SpaceModeStrip />

			<!-- Sidebar is a flex column, so the tree needs a sized track to scroll
			     inside rather than the sidebar's full height. -->
			<div class="flex min-h-0 flex-1 flex-col">
				<SpaceTreePanel
					:space-id="spaceId"
					:space-name="spaceStore.doc?.space_name"
					:space-route="spaceStore.doc?.route"
					:space-loaded="spaceStore.isLoaded"
					:tree-data="spaceStore.treeData"
					:space-root-node="spaceStore.treeData?.root_group || ''"
					:change-type-map="spaceStore.changeTypeMap"
					:readonly="spaceStore.isGitSynced"
					:selected-page-id="spaceStore.selectedPageId"
					:selected-draft-key="spaceStore.selectedDraftKey"
					compact-header
					@refresh="spaceStore.refreshTree"
					@reorder-state-change="spaceStore.setTreeReordering"
				/>
			</div>
		</Sidebar>
	</aside>
</template>

<script setup>
import { Avatar, Button, Dropdown, Sidebar } from 'frappe-ui';
import { computed } from 'vue';

import { useSpaceSettings } from '../composables/useSpaceSettings';
import { useSpaceStore } from '../stores/space';
import SpaceModeStrip from './SpaceModeStrip.vue';
import SpaceTreePanel from './SpaceTreePanel.vue';

const props = defineProps({
	spaceId: { type: String, required: true },
});

const spaceStore = useSpaceStore();
const { open: openSpaceSettings } = useSpaceSettings();

const spaceName = computed(
	() => spaceStore.doc?.space_name || spaceStore.doc?.name || props.spaceId,
);

const spaceActions = computed(() => {
	const options = [
		{
			label: __('Space settings'),
			icon: 'lucide-settings',
			onClick: openSpaceSettings,
		},
	];
	if (spaceStore.doc?.route) {
		options.push({
			label: __('View live site'),
			icon: 'lucide-external-link',
			onClick: () => window.open(`/${spaceStore.doc.route}`, '_blank'),
		});
	}
	if (spaceStore.isGitSynced) {
		options.push({
			label: __('Sync now'),
			icon: 'lucide-refresh-cw',
			onClick: () => spaceStore.syncNow(),
		});
	}
	return options;
});
</script>
