<template>
	<div
		class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
	>
		<div class="mr-4 flex-1">
			<p class="text-sm-medium text-ink-gray-9">{{ title }}</p>
			<p v-if="description" class="mt-0.5 text-xs text-ink-gray-5">
				{{ description }}
			</p>
		</div>
		<Switch v-model="value" :disabled="updating" @update:modelValue="update" />
	</div>
</template>

<script setup>
import { Switch } from 'frappe-ui';
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
