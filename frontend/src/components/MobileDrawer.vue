<template>
	<DialogRoot :open="open" @update:open="(v) => emit('update:open', v)">
		<DialogPortal>
			<DialogOverlay class="drawer-overlay fixed inset-0 z-40 bg-black/40" />
			<DialogContent
				:aria-describedby="undefined"
				:data-side="side"
				class="drawer-content fixed inset-y-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-surface-gray-1 shadow-xl"
				:class="side === 'right' ? 'right-0' : 'left-0'"
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
	side: { type: String, default: 'left' }, // 'left' | 'right'
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
.drawer-content[data-side='left'][data-state='open'] {
	animation: drawer-in-left 0.2s ease-out;
}
.drawer-content[data-side='left'][data-state='closed'] {
	animation: drawer-out-left 0.2s ease-in;
}
.drawer-content[data-side='right'][data-state='open'] {
	animation: drawer-in-right 0.2s ease-out;
}
.drawer-content[data-side='right'][data-state='closed'] {
	animation: drawer-out-right 0.2s ease-in;
}

@keyframes drawer-overlay-in {
	from { opacity: 0; }
	to { opacity: 1; }
}
@keyframes drawer-overlay-out {
	from { opacity: 1; }
	to { opacity: 0; }
}
@keyframes drawer-in-left {
	from { transform: translateX(-100%); }
	to { transform: translateX(0); }
}
@keyframes drawer-out-left {
	from { transform: translateX(0); }
	to { transform: translateX(-100%); }
}
@keyframes drawer-in-right {
	from { transform: translateX(100%); }
	to { transform: translateX(0); }
}
@keyframes drawer-out-right {
	from { transform: translateX(0); }
	to { transform: translateX(100%); }
}
</style>
