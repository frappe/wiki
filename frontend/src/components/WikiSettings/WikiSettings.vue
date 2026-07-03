<template>
	<div class="flex h-[80vh] max-h-[680px] overflow-hidden">
		<!-- Vertical navigation -->
		<div
			class="flex w-52 shrink-0 flex-col gap-4 border-r border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<span class="px-2 pt-1 text-lg-semibold text-ink-gray-9">
				{{ __('Wiki Settings') }}
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
		<div class="flex flex-1 flex-col overflow-hidden bg-surface-base">
			<div
				class="flex items-center justify-between border-b border-outline-gray-2 px-6 py-4"
			>
				<h2 class="text-2xl-semibold text-ink-gray-9">
					{{ activeTab?.label }}
				</h2>
				<Button variant="ghost" icon="x" @click="$emit('close')" />
			</div>
			<div class="flex-1 overflow-y-auto p-6">
				<div
					v-if="!settings.doc"
					class="flex h-full items-center justify-center"
				>
					<LoadingIndicator class="size-5 text-ink-gray-5" />
				</div>
				<template v-else>
					<GeneralPanel
						v-if="selectedTab === 'general'"
						:settings="settings"
					/>
					<FeedbackPanel
						v-else-if="selectedTab === 'feedback'"
						:settings="settings"
					/>
					<CodePanel
						v-else-if="selectedTab === 'code'"
						:settings="settings"
					/>
					<GitHubAppPanel
						v-else-if="selectedTab === 'github'"
						:settings="settings"
					/>
				</template>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Button, LoadingIndicator, createDocumentResource } from 'frappe-ui';
import { computed, ref } from 'vue';
import CodePanel from './CodePanel.vue';
import FeedbackPanel from './FeedbackPanel.vue';
import GeneralPanel from './GeneralPanel.vue';
import GitHubAppPanel from './GitHubAppPanel.vue';

const props = defineProps({
	initialTab: {
		type: String,
		default: 'general',
	},
});

defineEmits(['close']);

// Single doctype: fetched fresh each time the dialog opens (the component
// remounts), so the panels always reflect the latest saved values.
const settings = createDocumentResource({
	doctype: 'Wiki Settings',
	name: 'Wiki Settings',
	auto: true,
});

const tabs = [
	{ label: __('General'), value: 'general', icon: 'settings' },
	{ label: __('Feedback'), value: 'feedback', icon: 'message-square' },
	{ label: __('Header & Robots'), value: 'code', icon: 'code' },
	{ label: __('GitHub Sync'), value: 'github', icon: 'github' },
];

const selectedTab = ref(
	tabs.some((tab) => tab.value === props.initialTab)
		? props.initialTab
		: 'general',
);
const activeTab = computed(() =>
	tabs.find((tab) => tab.value === selectedTab.value),
);
</script>
