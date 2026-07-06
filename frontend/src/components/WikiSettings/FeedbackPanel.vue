<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingToggle
			:settings="settings"
			fieldname="enable_feedback"
			:title="__('Enable Feedback')"
			:description="
				__('Show a feedback widget on every wiki page to collect ratings and comments')
			"
		/>

		<SettingsRow
			v-if="settings.doc?.enable_feedback"
			:title="__('Feedback Submission Limit')"
			:description="__('Hourly rate limit on feedback submissions')"
		>
			<FormControl
				type="number"
				class="w-24"
				:min="0"
				:modelValue="submissionLimit"
				:disabled="updating"
				@update:modelValue="submissionLimit = $event"
				@change="updateLimit"
			/>
		</SettingsRow>
	</div>
</template>

<script setup>
import { FormControl, SettingsRow } from 'frappe-ui';
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
	const val = Math.max(0, Number.parseInt(submissionLimit.value, 10) || 0);
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
