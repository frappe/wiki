<template>
	<div class="rounded-lg border border-outline-gray-2 bg-surface-gray-1">
		<button
			type="button"
			class="flex w-full items-center justify-between gap-2 p-3 text-left"
			:aria-expanded="open"
			@click="open = !open"
		>
			<span class="text-sm font-medium text-ink-gray-9">{{ title }}</span>
			<LucideChevronDown
				class="size-4 shrink-0 text-ink-gray-5 transition-transform"
				:class="{ '-rotate-180': open }"
			/>
		</button>
		<div v-if="open" class="border-t border-outline-gray-2 p-3">
			<slot />
		</div>
	</div>
</template>

<script setup>
import { ref } from 'vue';
import LucideChevronDown from '~icons/lucide/chevron-down';

const props = defineProps({
	title: {
		type: String,
		required: true,
	},
	// Collapsed by default; opt into starting expanded.
	defaultOpen: {
		type: Boolean,
		default: false,
	},
});

const open = ref(props.defaultOpen);
</script>
