<template>
	<!-- Inline: the grid on its own. Used inside a Dialog, whose focus trap
	     swallows a nested popover's interactions. -->
	<div
		v-if="inline"
		class="overflow-hidden rounded-lg border border-outline-gray-2 bg-surface-elevation-1"
	>
		<IconGrid :model-value="modelValue" @select="selectIcon($event)" />
	</div>

	<PopoverRoot v-else v-model:open="isOpen">
		<PopoverAnchor as-child>
			<slot v-bind="{ isOpen, togglePopover }">
				<Button
					:icon="modelValue || 'lucide-plus'"
					:label="__('Tab Icon')"
					@click="togglePopover()"
				/>
			</slot>
		</PopoverAnchor>

		<PopoverPortal>
			<PopoverContent
				side="bottom"
				align="start"
				:side-offset="6"
				:collision-padding="12"
				class="z-[100] outline-none"
				@open-auto-focus.prevent
			>
				<div
					class="max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg bg-surface-elevation-2 text-base shadow-2xl ring-1 ring-black ring-opacity-5"
				 	style="transform-origin: var(--reka-popover-content-transform-origin)"
				>
					<IconGrid
						:model-value="modelValue"
						@select="selectIcon($event, togglePopover)"
					/>
				</div>
			</PopoverContent>
		</PopoverPortal>
	</PopoverRoot>
</template>

<script setup>
import { Button } from 'frappe-ui';
import {
	PopoverAnchor,
	PopoverContent,
	PopoverPortal,
	PopoverRoot,
} from 'reka-ui';
import { ref } from 'vue';

import { TAB_ICONS } from '../lib/tabIcons.js';
import IconGrid from './IconGrid.vue';

defineProps({
	modelValue: { type: String, default: '' },
	// Renders the grid directly instead of behind a popover. Required inside a
	// Dialog, whose focus trap swallows the nested popover's interactions.
	inline: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);

// This list is load-bearing beyond taste. Tailwind's JIT only emits a
// `lucide-*` class it can find as a literal in scanned source, and tab_icon
// arrives from the database at runtime — so these literals ARE the safelist.
// A free-text search over all ~1994 lucide icons would render blank for
// anything not otherwise mentioned in source. Adding an icon means adding it
// here.

// Passthrough for now; the original planned a search box that was never wired.
const filteredIcons = TAB_ICONS;

function selectIcon(icon, close) {
	emit('update:modelValue', icon);
	if (close) close();
}

function togglePopover(flag) {
	if (flag instanceof Event || flag === undefined) {
		isOpen.value = !isOpen.value;
		return;
	}
	isOpen.value = flag;
}
</script>
