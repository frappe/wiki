<template>
	<DialogRoot :open="open" @update:open="(v) => emit('update:open', v)">
		<DialogPortal>
			<DialogOverlay class="drawer-overlay fixed inset-0 z-40 bg-black-overlay-200 dark:bg-black-overlay-700" />
			<DialogContent
				:aria-describedby="undefined"
				:data-side="side"
				class="drawer-content fixed inset-y-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-surface-gray-1 shadow-xl"
				:class="side === 'end' ? 'end-0' : 'start-0'"
			>
				<!-- Required by reka-ui for an accessible name; not shown. -->
				<DialogTitle class="sr-only">{{ title }}</DialogTitle>
				<slot />
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>

<script setup>
// reka-ui has no literal Drawer; we compose one from the Dialog primitives
// (focus-trap, scroll-lock, ESC, ARIA) plus our own slide-in transition below.
import {
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogRoot,
	DialogTitle,
} from 'reka-ui';

defineProps({
	open: { type: Boolean, default: false },
	side: { type: String, default: 'start' }, // 'start' | 'end'
	title: { type: String, default: '' },
});

const emit = defineEmits(['update:open']);
</script>

<style scoped>
/* Keyframes (not CSS transitions) so reka-ui's Presence animates the panel on
   both enter and leave — a plain transition won't run on initial mount. */
.drawer-overlay[data-state='open'] {
	animation: drawer-overlay-in 0.2s ease-out;
}
.drawer-overlay[data-state='closed'] {
	animation: drawer-overlay-out 0.2s ease-in;
}
.drawer-content {
	--drawer-hidden-x: -100%;
}
.drawer-content[data-side='end'],
.drawer-content[data-side='start']:dir(rtl) {
	--drawer-hidden-x: 100%;
}
.drawer-content[data-side='end']:dir(rtl) {
	--drawer-hidden-x: -100%;
}
.drawer-content[data-state='open'] {
	animation: drawer-in 0.2s ease-out;
}
.drawer-content[data-state='closed'] {
	animation: drawer-out 0.2s ease-in;
}

@keyframes drawer-overlay-in {
	from { opacity: 0; }
	to { opacity: 1; }
}
@keyframes drawer-overlay-out {
	from { opacity: 1; }
	to { opacity: 0; }
}
@keyframes drawer-in {
	from { transform: translateX(var(--drawer-hidden-x)); }
	to { transform: translateX(0); }
}
@keyframes drawer-out {
	from { transform: translateX(0); }
	to { transform: translateX(var(--drawer-hidden-x)); }
}
</style>
