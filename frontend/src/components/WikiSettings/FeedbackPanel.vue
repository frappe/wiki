<template>
	<div class="flex flex-col gap-4">
		<SettingToggle
			:settings="settings"
			fieldname="enable_feedback"
			:title="__('Enable Feedback')"
			:description="
				__('Show a feedback widget on every wiki page to collect ratings and comments')
			"
		/>

		<SettingToggle
			:settings="settings"
			fieldname="ask_for_contact_details"
			:title="__('Ask for Contact Details')"
			:description="
				__('Ask visitors for their email when submitting feedback')
			"
		/>

		<div
			v-if="settings.doc?.enable_feedback"
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Feedback Submission Limit') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('Hourly rate limit on feedback submissions') }}
				</p>
			</div>
			<FormControl
				type="number"
				class="w-24"
				:min="0"
				:modelValue="submissionLimit"
				:disabled="updating"
				@update:modelValue="submissionLimit = $event"
				@change="updateLimit"
			/>
		</div>
	</div>
</template>

<script setup>
import { FormControl } from 'frappe-ui';
import { ref, watch } from 'vue';
import SettingToggle from './SettingToggle.vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
});

const submissionLimit = ref(0);
const updating = ref(false);

watch(
	() => props.settings.doc?.feedback_submission_limit,
	(v) => {
		submissionLimit.value = v ?? 0;
	},
	{ immediate: true },
);

async function updateLimit() {
	const val = Math.max(0, parseInt(submissionLimit.value, 10) || 0);
	submissionLimit.value = val;
	if (val === props.settings.doc?.feedback_submission_limit) return;
	updating.value = true;
	try {
		await props.settings.setValue.submit({ feedback_submission_limit: val });
	} catch (error) {
		console.error('Failed to update feedback submission limit:', error);
		submissionLimit.value = props.settings.doc?.feedback_submission_limit ?? 0;
	} finally {
		updating.value = false;
	}
}
</script>
