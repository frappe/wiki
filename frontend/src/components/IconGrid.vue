<template>
	<div class="relative">
		<div class="max-h-72 overflow-y-auto p-2 pb-5">
			<div
				class="grid grid-cols-8 gap-1"
				role="listbox"
				:aria-label="__('Tab icons')"
			>
				<button
					v-for="icon in TAB_ICONS"
					:key="icon.class"
					type="button"
					role="option"
					class="flex size-8 items-center justify-center rounded text-ink-gray-7 hover:bg-surface-gray-2"
					:class="icon.class === modelValue ? 'bg-surface-gray-3 text-ink-gray-9' : ''"
					:title="icon.label"
					:aria-label="icon.label"
					:aria-selected="icon.class === modelValue"
					@click="emit('select', icon.class)"
				>
					<span :class="[icon.class, 'size-5']" />
				</button>
			</div>
		</div>
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-elevation-2 to-transparent"
		/>
	</div>
</template>

<script setup>
import { TAB_ICONS } from '../lib/tabIcons.js';

defineProps({
	modelValue: { type: String, default: '' },
});

const emit = defineEmits(['select']);
</script>
