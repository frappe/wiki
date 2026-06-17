<template>
	<div class="flex flex-col gap-4">
		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Published') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('Make this wiki space publicly accessible') }}
				</p>
			</div>
			<Switch
				v-model="isPublished"
				:disabled="updatingPublishSetting"
				@update:modelValue="updatePublishSetting"
			/>
		</div>

		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Enable Feedback Collection') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('Show a feedback widget on wiki pages to collect user reactions') }}
				</p>
			</div>
			<Switch
				v-model="enableFeedbackCollection"
				:disabled="updatingFeedbackSetting"
				@update:modelValue="updateFeedbackSetting"
			/>
		</div>

		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Bulk Update Routes') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('Change the base route for this space and all its pages') }}
				</p>
			</div>
			<Button variant="outline" size="sm" @click="$emit('open-update-routes')">
				{{ __('Update') }}
			</Button>
		</div>

		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Clone Space') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('Create a new space with the same structure') }}
				</p>
			</div>
			<Button variant="outline" size="sm" @click="$emit('open-clone')">
				{{ __('Clone') }}
			</Button>
		</div>
	</div>
</template>

<script setup>
import { Button, Switch } from 'frappe-ui';
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
