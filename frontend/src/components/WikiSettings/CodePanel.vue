<template>
	<div class="flex flex-col gap-6">
		<Textarea
			v-model="headHtml"
			:label="__('<head> HTML')"
			:description="__('Injected into the <head> of all public wiki pages')"
			:rows="8"
			spellcheck="false"
			class="[&_textarea]:font-mono"
		/>

		<div class="flex items-center justify-end gap-2">
			<Badge v-if="isDirty" theme="orange" size="sm">
				{{ __('Unsaved changes') }}
			</Badge>
			<Button
				variant="solid"
				:loading="saving"
				:disabled="!isDirty"
				@click="save"
			>
				{{ __('Save') }}
			</Button>
		</div>
	</div>
</template>

<script setup>
import { Badge, Button, Textarea } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
});

const headHtml = ref('');
const saving = ref(false);

watch(
	() => props.settings.doc,
	(doc) => {
		if (doc) {
			headHtml.value = doc.head_html || '';
		}
	},
	{ immediate: true },
);

const isDirty = computed(
	() => headHtml.value !== (props.settings.doc?.head_html || ''),
);

async function save() {
	saving.value = true;
	try {
		await props.settings.setValue.submit({ head_html: headHtml.value });
	} catch (error) {
		console.error('Failed to save header HTML:', error);
	} finally {
		saving.value = false;
	}
}
</script>
