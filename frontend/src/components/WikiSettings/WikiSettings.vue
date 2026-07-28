<template>
	<SettingsDialog v-model="open" v-model:tab="selectedTab">
		<SettingsSidebar>
			<div>
				<span class="block px-2 pt-1 pb-3 text-lg-semibold text-ink-gray-9">
					{{ __('Wiki Settings') }}
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
			<SettingsPanel v-for="tab in tabs" :key="tab.value" :value="tab.value">
				<SettingsHeader :title="tab.label" />
				<SettingsBody>
					<div
						v-if="!settings.doc"
						class="flex h-full items-center justify-center"
					>
						<LoadingIndicator class="size-5 text-ink-gray-5" />
					</div>
					<component
						v-else
						:is="tab.component"
						:settings="settings"
						class="pt-6"
					/>
				</SettingsBody>
			</SettingsPanel>
		</SettingsContent>
	</SettingsDialog>
</template>

<script setup>
import {
	LoadingIndicator,
	SettingsBody,
	SettingsContent,
	SettingsDialog,
	SettingsHeader,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
	createDocumentResource,
} from 'frappe-ui';
import { computed, markRaw, ref, watch } from 'vue';
import CodePanel from './CodePanel.vue';
import FeedbackPanel from './FeedbackPanel.vue';
import GeneralPanel from './GeneralPanel.vue';
import GitHubAppPanel from './GitHubAppPanel.vue';

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	initialTab: {
		type: String,
		default: 'general',
	},
});

const emit = defineEmits(['update:modelValue']);

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit('update:modelValue', value),
});

// Single doctype: refetched each time the dialog opens so the panels always
// reflect the latest saved values.
const settings = createDocumentResource({
	doctype: 'Wiki Settings',
	name: 'Wiki Settings',
	auto: true,
});

watch(
	() => props.modelValue,
	(isOpen) => {
		if (isOpen) settings.reload();
	},
);

const tabs = [
	{
		label: __('General'),
		value: 'general',
		icon: 'lucide-settings',
		component: markRaw(GeneralPanel),
	},
	{
		label: __('Feedback'),
		value: 'feedback',
		icon: 'lucide-message-square',
		component: markRaw(FeedbackPanel),
	},
	{
		label: __('Header & Robots'),
		value: 'code',
		icon: 'lucide-code',
		component: markRaw(CodePanel),
	},
	{
		label: __('GitHub Sync'),
		value: 'github',
		// lucide-static dropped brand icons, so no `lucide-github`.
		icon: 'lucide-git-branch',
		component: markRaw(GitHubAppPanel),
	},
];

const selectedTab = ref(
	tabs.some((tab) => tab.value === props.initialTab)
		? props.initialTab
		: 'general',
);

watch(
	() => props.initialTab,
	(tab) => {
		if (tabs.some((t) => t.value === tab)) selectedTab.value = tab;
	},
);
</script>
