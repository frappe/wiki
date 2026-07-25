<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingToggle
			:settings="settings"
			fieldname="enable_table_of_contents"
			:title="__('Enable Table of Contents')"
			:description="__('Show an auto-generated table of contents on wiki pages')"
		/>

		<SettingToggle
			:settings="settings"
			fieldname="auto_convert_images_to_webp"
			:title="__('Auto Convert Image to WebP')"
			:description="
				__('Automatically convert uploaded PNG/JPEG images to WebP to reduce page size')
			"
		/>

		<SettingToggle
			:settings="settings"
			fieldname="auto_generate_meta_images"
			:title="__('Auto Generate Meta Images')"
			:description="
				__(
					'Generate a branded social preview image for pages that have no Meta Image uploaded',
				)
			"
		/>
	</div>
</template>

<script setup>
import SettingToggle from './SettingToggle.vue';

defineProps({
	settings: {
		type: Object,
		required: true,
	},
});
</script>
