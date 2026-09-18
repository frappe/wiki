<template>
	<SettingsRow
		:title="__('Enable View Tracking')"
		:description="
			__('Count visits to published pages, which is what the Overview reports')
		"
	>
		<Switch
			v-model="enabled"
			:disabled="tracking.loading || updating"
			@update:modelValue="update"
		/>
	</SettingsRow>
</template>

<script setup>
import { SettingsRow, Switch, createResource } from 'frappe-ui';
import { ref } from 'vue';

const enabled = ref(false);
const updating = ref(false);

const tracking = createResource({
	url: 'wiki.api.analytics.get_view_tracking',
	auto: true,
	onSuccess: (value) => {
		enabled.value = Boolean(value);
	},
});

const setTracking = createResource({ url: 'wiki.api.analytics.set_view_tracking' });

async function update(value) {
	updating.value = true;
	try {
		await setTracking.submit({ enabled: value });
	} catch (error) {
		console.error('Failed to update view tracking:', error);
		enabled.value = !value;
	} finally {
		updating.value = false;
	}
}
</script>
