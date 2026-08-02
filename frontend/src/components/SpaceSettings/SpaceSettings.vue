<template>
	<SettingsDialog v-model="open" v-model:tab="selectedTab">
		<SettingsSidebar>
			<div>
				<span class="block px-2 pt-1 pb-3 text-lg-semibold text-ink-gray-9">
					{{ __('Settings') }}
				</span>
				<div class="flex flex-col gap-1">
					<SettingsNavItem
						v-for="tab in tabs"
						:key="tab.value"
						:value="tab.value"
					>
						<template #prefix>
							<span :class="[tab.icon, 'size-4 shrink-0 text-ink-gray-6']" />
						</template>
						{{ tab.label }}
					</SettingsNavItem>
				</div>
			</div>
		</SettingsSidebar>
		<SettingsContent>
			<SettingsPanel value="general">
				<SettingsHeader :title="__('General')" />
				<SettingsBody>
					<GeneralPanel
						class="pt-6"
						:space="space"
						@open-update-routes="$emit('open-update-routes')"
						@open-clone="$emit('open-clone')"
					/>
				</SettingsBody>
			</SettingsPanel>
			<SettingsPanel value="permissions">
				<SettingsHeader>
					<div class="flex items-center gap-2">
						<h2 class="text-lg font-semibold text-ink-gray-8">
							{{ __('Permissions') }}
						</h2>
						<Badge theme="violet" size="sm">
							{{ __('Beta') }}
						</Badge>
						<Badge v-if="permissionsDirty" theme="orange" size="sm">
							{{ __('Unsaved changes') }}
						</Badge>
					</div>
				</SettingsHeader>
				<SettingsBody>
					<PermissionsPanel
						class="pt-6"
						:space="space"
						:space-id="spaceId"
						@update:dirty="permissionsDirty = $event"
					/>
				</SettingsBody>
			</SettingsPanel>
			<SettingsPanel v-if="space.doc?.git_synced" value="git-sync">
				<SettingsHeader :title="__('GitHub Sync')" />
				<SettingsBody>
					<GitSyncPanel class="pt-6" :space="space" :space-id="spaceId" />
				</SettingsBody>
			</SettingsPanel>
		</SettingsContent>
	</SettingsDialog>
</template>

<script setup>
import {
	Badge,
	SettingsBody,
	SettingsContent,
	SettingsDialog,
	SettingsHeader,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from 'frappe-ui';
import { computed, ref } from 'vue';
import GeneralPanel from './GeneralPanel.vue';
import GitSyncPanel from './GitSyncPanel.vue';
import PermissionsPanel from './PermissionsPanel.vue';

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	space: {
		type: Object,
		required: true,
	},
	spaceId: {
		type: String,
		required: true,
	},
});

const emit = defineEmits([
	'update:modelValue',
	'open-update-routes',
	'open-clone',
]);

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit('update:modelValue', value),
});

const tabs = computed(() => {
	const items = [
		{ label: __('General'), value: 'general', icon: 'lucide-settings' },
		{ label: __('Permissions'), value: 'permissions', icon: 'lucide-lock' },
	];
	// GitHub Sync settings only apply to git-synced spaces.
	if (props.space.doc?.git_synced) {
		items.push({
			label: __('GitHub Sync'),
			value: 'git-sync',
			// lucide-static dropped brand icons, so no `lucide-github`.
			icon: 'lucide-git-branch',
		});
	}
	return items;
});

const selectedTab = ref('general');
const permissionsDirty = ref(false);
</script>
