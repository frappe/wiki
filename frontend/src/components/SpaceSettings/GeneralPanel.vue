<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingsRow
			:title="__('Published')"
			:description="__('Make this wiki space publicly accessible')"
		>
			<Switch
				v-model="isPublished"
				:disabled="updatingPublishSetting"
				@update:modelValue="updatePublishSetting"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Enable Feedback Collection')"
			:description="
				__('Show a feedback widget on wiki pages to collect user reactions')
			"
		>
			<Switch
				v-model="enableFeedbackCollection"
				:disabled="updatingFeedbackSetting"
				@update:modelValue="updateFeedbackSetting"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Bulk Update Routes')"
			:description="__('Change the base route for this space and all its pages')"
		>
			<Button variant="outline" @click="$emit('open-update-routes')">
				{{ __('Update') }}
			</Button>
		</SettingsRow>

		<SettingsRow
			:title="__('Clone Space')"
			:description="__('Create a new space with the same structure')"
		>
			<Button variant="outline" @click="$emit('open-clone')">
				{{ __('Clone') }}
			</Button>
		</SettingsRow>
	</div>
</template>

<script setup>
import { Button, SettingsRow, Switch } from 'frappe-ui';
import { ref, watch } from 'vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
});

defineEmits(['open-update-routes', 'open-clone']);

const isPublished = ref(true);
const enableFeedbackCollection = ref(false);
const updatingPublishSetting = ref(false);
const updatingFeedbackSetting = ref(false);

watch(
	() => props.space.doc,
	(doc) => {
		if (doc) {
			isPublished.value = Boolean(doc.is_published);
			enableFeedbackCollection.value = Boolean(doc.enable_feedback_collection);
		}
	},
	{ immediate: true },
);

async function updatePublishSetting(value) {
	updatingPublishSetting.value = true;
	try {
		await props.space.setValue.submit({ is_published: value ? 1 : 0 });
	} catch (error) {
		console.error('Failed to update publish setting:', error);
		isPublished.value = !value;
	} finally {
		updatingPublishSetting.value = false;
	}
}

async function updateFeedbackSetting(value) {
	updatingFeedbackSetting.value = true;
	try {
		await props.space.setValue.submit({
			enable_feedback_collection: value ? 1 : 0,
		});
	} catch (error) {
		console.error('Failed to update feedback setting:', error);
		enableFeedbackCollection.value = !value;
	} finally {
		updatingFeedbackSetting.value = false;
	}
}
</script>
