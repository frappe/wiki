<template>
	<SettingsRow :title="title" :description="description">
		<Switch v-model="value" :disabled="updating" @update:modelValue="update" />
	</SettingsRow>
</template>

<script setup>
import { SettingsRow, Switch } from 'frappe-ui';
import { ref, watch } from 'vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
	fieldname: {
		type: String,
		required: true,
	},
	title: {
		type: String,
		required: true,
	},
	description: {
		type: String,
		default: '',
	},
});

const value = ref(false);
const updating = ref(false);

watch(
	() => props.settings.doc?.[props.fieldname],
	(v) => {
		value.value = Boolean(v);
	},
	{ immediate: true },
);

async function update(val) {
	updating.value = true;
	try {
		await props.settings.setValue.submit({ [props.fieldname]: val ? 1 : 0 });
	} catch (error) {
		console.error(`Failed to update ${props.fieldname}:`, error);
		value.value = !val;
	} finally {
		updating.value = false;
	}
}
</script>
