<template>
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-1.5">
			<label class="text-sm font-medium text-ink-gray-9">
				{{ __('<head> HTML') }}
			</label>
			<p class="text-xs text-ink-gray-5">
				{{ __('Injected into the <head> of all public wiki pages') }}
			</p>
			<textarea
				v-model="headHtml"
				rows="6"
				spellcheck="false"
				class="w-full rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3 font-mono text-xs text-ink-gray-9 focus:border-outline-gray-3 focus:outline-none"
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<label class="text-sm font-medium text-ink-gray-9">
				{{ __('JavaScript') }}
			</label>
			<p class="text-xs text-ink-gray-5">
				{{ __('Custom JavaScript included on all public wiki pages') }}
			</p>
			<textarea
				v-model="javascript"
				rows="6"
				spellcheck="false"
				class="w-full rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3 font-mono text-xs text-ink-gray-9 focus:border-outline-gray-3 focus:outline-none"
			/>
		</div>

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
import { Badge, Button } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
});

const headHtml = ref('');
const javascript = ref('');
const saving = ref(false);

watch(
	() => props.settings.doc,
	(doc) => {
		if (doc) {
			headHtml.value = doc.head_html || '';
			javascript.value = doc.javascript || '';
		}
	},
	{ immediate: true },
);

const isDirty = computed(
	() =>
		headHtml.value !== (props.settings.doc?.head_html || '') ||
		javascript.value !== (props.settings.doc?.javascript || ''),
);

async function save() {
	saving.value = true;
	try {
		await props.settings.setValue.submit({
			head_html: headHtml.value,
			javascript: javascript.value,
		});
	} catch (error) {
		console.error('Failed to save header/robots settings:', error);
	} finally {
		saving.value = false;
	}
}
</script>
