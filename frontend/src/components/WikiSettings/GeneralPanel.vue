<template>
	<div class="flex flex-col gap-4">
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
import SettingToggle from './SettingToggle.vue';

defineProps({
	settings: {
		type: Object,
		required: true,
	},
});
</script>
