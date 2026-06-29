<template>
	<div class="flex flex-col gap-4">
		<div
			class="rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<p class="text-sm font-medium text-ink-gray-9">
				{{ __('Default Wiki Space') }}
			</p>
			<p class="mt-0.5 text-xs text-ink-gray-5">
				{{ __('The space visitors land on when they open the wiki root') }}
			</p>
			<Autocomplete
				class="mt-2"
				:options="spaceOptions"
				:modelValue="selectedSpace"
				:placeholder="__('Select a space')"
				@update:modelValue="updateDefaultSpace"
			/>
		</div>

		<SettingToggle
			:settings="settings"
			fieldname="enable_table_of_contents"
			:title="__('Enable Table of Contents')"
			:description="__('Show an auto-generated table of contents on wiki pages')"
		/>

		<SettingToggle
			:settings="settings"
			fieldname="auto_convert_images_to_webp"
			:title="__('Convert Uploaded Images to WebP')"
			:description="
				__('Automatically convert uploaded PNG/JPEG images to WebP to reduce page size')
			"
		/>
	</div>
</template>

<script setup>
import { Autocomplete, createResource } from 'frappe-ui';
import { computed } from 'vue';
import SettingToggle from './SettingToggle.vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
});

const spacesResource = createResource({
	url: 'wiki.wiki.doctype.wiki_settings.wiki_settings.get_all_spaces',
	auto: true,
});

const spaceOptions = computed(() =>
	(spacesResource.data || []).map((route) => ({ label: route, value: route })),
);

const selectedSpace = computed(() => {
	const value = props.settings.doc?.default_wiki_space;
	return value ? { label: value, value } : null;
});

async function updateDefaultSpace(option) {
	await props.settings.setValue.submit({
		default_wiki_space: option?.value || '',
	});
}
</script>
