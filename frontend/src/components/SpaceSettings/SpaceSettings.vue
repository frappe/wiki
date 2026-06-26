<template>
	<div class="flex h-[80vh] max-h-[680px] overflow-hidden">
		<!-- Vertical navigation -->
		<div
			class="flex w-52 shrink-0 flex-col gap-4 border-r border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<span class="px-2 pt-1 text-lg font-semibold text-ink-gray-9">
				{{ __('Settings') }}
			</span>
			<div class="flex flex-col gap-1">
				<Button
					v-for="tab in tabs"
					:key="tab.value"
					:variant="selectedTab === tab.value ? 'subtle' : 'ghost'"
					:icon-left="tab.icon"
					class="!justify-start"
					:class="{ '!bg-surface-gray-3': selectedTab === tab.value }"
					@click="selectedTab = tab.value"
				>
					{{ tab.label }}
				</Button>
			</div>
		</div>

		<!-- Active panel -->
		<div class="flex flex-1 flex-col overflow-hidden bg-surface-white">
			<div
				class="flex items-center justify-between border-b border-outline-gray-2 px-6 py-4"
			>
				<div class="flex items-center gap-2">
					<h2 class="text-xl font-semibold text-ink-gray-9">
						{{ activeTab?.label }}
					</h2>
					<Badge
						v-if="selectedTab === 'permissions'"
						theme="orange"
						size="sm"
					>
						{{ __('Beta') }}
					</Badge>
					<Badge
						v-if="selectedTab === 'permissions' && permissionsDirty"
						theme="orange"
						size="sm"
					>
						{{ __('Unsaved changes') }}
					</Badge>
				</div>
				<Button variant="ghost" icon="x" @click="$emit('close')" />
			</div>
			<div class="flex-1 overflow-y-auto p-6">
				<GeneralPanel
					v-if="selectedTab === 'general'"
					:space="space"
					@open-update-routes="$emit('open-update-routes')"
					@open-clone="$emit('open-clone')"
				/>
				<PermissionsPanel
					v-else-if="selectedTab === 'permissions'"
					:space="space"
					:space-id="spaceId"
					@update:dirty="permissionsDirty = $event"
				/>
				<GitSyncPanel
					v-else-if="selectedTab === 'git-sync'"
					:space="space"
					:space-id="spaceId"
				/>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Badge, Button } from 'frappe-ui';
import { computed, ref } from 'vue';
import GeneralPanel from './GeneralPanel.vue';
import GitSyncPanel from './GitSyncPanel.vue';
import PermissionsPanel from './PermissionsPanel.vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
	spaceId: {
		type: String,
		required: true,
	},
});

defineEmits(['close', 'open-update-routes', 'open-clone']);

const tabs = computed(() => {
	const items = [
		{ label: __('General'), value: 'general', icon: 'settings' },
		{ label: __('Permissions'), value: 'permissions', icon: 'lock' },
	];
	// GitHub Sync settings only apply to git-synced spaces.
	if (props.space.doc?.git_synced) {
		items.push({ label: __('GitHub Sync'), value: 'git-sync', icon: 'github' });
	}
	return items;
});

const selectedTab = ref('general');
const permissionsDirty = ref(false);
const activeTab = computed(() =>
	tabs.value.find((tab) => tab.value === selectedTab.value),
);
</script>
