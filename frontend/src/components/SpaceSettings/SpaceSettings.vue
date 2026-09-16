<template>
	<SettingsDialog v-model:open="open" v-model:tab="selectedTab">
		<SettingsSidebar>
			<div>
				<span
					class="block truncate px-2 pt-1 pb-3 text-lg-semibold text-ink-gray-9"
				>
					{{ space.doc?.space_name || __('Space') }}
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
			<SettingsPanel value="navigation">
				<SettingsHeader :title="__('Navigation')" />
				<SettingsBody>
					<NavigationPanel class="pt-6" :space="space" />
				</SettingsBody>
			</SettingsPanel>
			<SettingsPanel value="access">
				<SettingsHeader>
					<div class="flex items-center gap-2">
						<h2 class="text-lg font-semibold text-ink-gray-8">
							{{ __('Access') }}
						</h2>
						<Badge theme="violet" size="sm">
							{{ __('Beta') }}
						</Badge>
						<Badge v-if="accessDirty" theme="amber" size="sm">
							{{ __('Unsaved changes') }}
						</Badge>
					</div>
				</SettingsHeader>
				<SettingsBody>
					<AccessPanel
						class="pt-6"
						:space="space"
						:space-id="spaceId"
						@update:dirty="accessDirty = $event"
					/>
				</SettingsBody>
			</SettingsPanel>
			<SettingsPanel value="git-sync">
				<SettingsHeader :title="__('Git Sync')" />
				<SettingsBody>
					<GitSyncPanel
						v-if="isGitSynced"
						class="pt-6"
						:space="space"
						:space-id="spaceId"
					/>
					<!-- A space is bound to a repository when it is created, so there
					     is nothing to connect from here — say so rather than offer a
					     button that leads nowhere. -->
					<div
						v-else
						class="flex flex-col items-center justify-center py-16 text-center"
					>
						<span
							class="lucide-git-branch size-8 text-ink-gray-4"
							aria-hidden="true"
						/>
						<p class="mt-3 text-base-medium text-ink-gray-8">
							{{ __('Not connected to a repository') }}
						</p>
						<p class="mt-1 max-w-sm text-sm text-ink-gray-5">
							{{
								__(
									'A space is connected to GitHub when it is created. A connected space is read-only in the editor — its pages come from the repository.',
								)
							}}
						</p>
					</div>
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
import AccessPanel from './AccessPanel.vue';
import GeneralPanel from './GeneralPanel.vue';
import GitSyncPanel from './GitSyncPanel.vue';
import NavigationPanel from './NavigationPanel.vue';

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

const isGitSynced = computed(() => Boolean(props.space.doc?.git_synced));

// The tab set does not depend on the space: a tab that appears only for some
// spaces teaches people the settings move around.
const tabs = computed(() => [
	{ label: __('General'), value: 'general', icon: 'lucide-settings' },
	{ label: __('Navigation'), value: 'navigation', icon: 'lucide-list-tree' },
	{ label: __('Access'), value: 'access', icon: 'lucide-lock' },
	// lucide-static dropped brand icons, so no `lucide-github`.
	{ label: __('Git Sync'), value: 'git-sync', icon: 'lucide-git-branch' },
]);

const selectedTab = ref('general');
const accessDirty = ref(false);
</script>
