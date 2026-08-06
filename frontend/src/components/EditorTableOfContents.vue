<template>
	<!-- The rail keeps its width even with nothing to list, so the content column
	     doesn't slide sideways the moment the author types their first `##`. -->
	<aside
		v-if="variant === 'rail'"
		ref="rootRef"
		class="w-[220px] shrink-0 py-6 pr-6"
		data-testid="editor-toc-rail"
	>
		<nav
			v-if="outline.length"
			class="hide-scrollbar sticky flex flex-col overflow-y-auto text-sm leading-relaxed"
			:style="{ top: `${railTop}px`, maxHeight: `calc(100vh - ${railTop}px - 4rem)` }"
		>
			<!-- Transparent border keeps the label on the same left edge as the links. -->
			<span class="whitespace-nowrap border-l border-transparent pl-4 pb-1 font-medium text-ink-gray-8">
				{{ __('On this page') }}
			</span>
			<button
				v-for="(entry, index) in outline"
				:key="entry.pos"
				type="button"
				data-testid="editor-toc-link"
				class="truncate border-l py-1 text-left"
				:class="[
					entry.level >= 3 && hasH2 ? 'pl-7' : 'pl-4',
					index === activeIndex
						? 'border-outline-gray-4 text-ink-gray-9'
						: 'border-outline-gray-2 text-ink-gray-6 hover:text-ink-gray-9',
				]"
				@click="goTo(entry)"
			>
				{{ entry.text }}
			</button>
		</nav>
	</aside>

	<!-- Narrow layouts get the reader's collapsed strip instead: one row that
	     names the section you're in, expanding to the full list on tap. -->
	<div
		v-else
		ref="rootRef"
		class="sticky z-30 bg-surface-base"
		:style="{ top: `${toolbarHeight}px` }"
		data-testid="editor-toc-strip"
	>
		<template v-if="outline.length">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-2 border-b border-outline-gray-2 px-4 py-2 text-sm text-ink-gray-7 hover:bg-surface-gray-2"
				data-testid="editor-toc-toggle"
				:aria-expanded="open"
				@click="open = !open"
			>
				<span class="flex items-center gap-2">
					<span class="lucide-list size-4 shrink-0" aria-hidden="true" />
					{{ __('On this page') }}
				</span>
				<span class="flex min-w-0 items-center gap-2">
					<span class="truncate text-ink-gray-5">{{ activeText }}</span>
					<span
						class="lucide-chevron-down size-4 shrink-0 transition-transform"
						:class="open ? 'rotate-180' : ''"
						aria-hidden="true"
					/>
				</span>
			</button>
			<nav
				v-if="open"
				class="max-h-64 overflow-y-auto border-b border-outline-gray-2 bg-surface-gray-1 py-1"
			>
				<button
					v-for="(entry, index) in outline"
					:key="entry.pos"
					type="button"
					data-testid="editor-toc-link"
					class="flex w-full items-center gap-2 py-2 pr-4 text-left text-sm"
					:class="index === activeIndex
						? 'bg-surface-gray-2 font-medium text-ink-gray-9'
						: 'text-ink-gray-6'"
					:style="{ paddingLeft: `${1 + (entry.level - 2) * 0.75}rem` }"
					@click="goTo(entry, { collapse: true })"
				>
					<span
						class="size-1.5 shrink-0 rounded-full"
						:class="index === activeIndex ? 'bg-ink-gray-7' : 'bg-ink-gray-4'"
						aria-hidden="true"
					/>
					<span class="truncate">{{ entry.text }}</span>
				</button>
			</nav>
		</template>
	</div>
</template>

<script setup>
import { useDocumentOutline } from '@/composables/useDocumentOutline';
import { useEventListener } from '@vueuse/core';
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from 'vue';

const props = defineProps({
	editor: {
		type: Object,
		default: null,
	},
	// 'rail' — the reader's right-hand column, for widths that can spare it.
	// 'strip' — a collapsible row under the toolbar, for everything narrower.
	variant: {
		type: String,
		default: 'rail',
	},
});

const rootRef = ref(null);
const activeIndex = ref(0);
const toolbarHeight = ref(0);
const open = ref(false);

const { outline } = useDocumentOutline(() => props.editor);

// The reader indents h3s only on pages that also have an h2 — on an all-h3 page
// a blanket indent leaves the "On this page" label hanging off the rail.
const hasH2 = computed(() => outline.value.some((entry) => entry.level === 2));
const activeText = computed(() => outline.value[activeIndex.value]?.text || '');

const railTop = computed(() => toolbarHeight.value + 24);

// The editor's nearest scrollable ancestor owns both the scroll position we
// spy on and the sticky context the rail lives in.
let scrollContainer = null;

function findScrollContainer(element) {
	let node = element?.parentElement;
	while (node) {
		const overflowY = getComputedStyle(node).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') return node;
		node = node.parentElement;
	}
	return null;
}

function measureToolbar() {
	toolbarHeight.value =
		scrollContainer?.querySelector('.wiki-toolbar')?.offsetHeight || 0;
}

function headingElement(pos) {
	try {
		const node = props.editor?.view?.nodeDOM(pos);
		return node?.nodeType === Node.ELEMENT_NODE ? node : null;
	} catch {
		// A stale position from an outline computed a transaction ago.
		return null;
	}
}

function updateActive() {
	if (!scrollContainer || !outline.value.length) return;
	// Anything above the toolbar's lower edge has already scrolled out of sight.
	const threshold =
		scrollContainer.getBoundingClientRect().top + toolbarHeight.value + 16;

	let next = 0;
	for (const [index, entry] of outline.value.entries()) {
		const element = headingElement(entry.pos);
		if (!element) continue;
		if (element.getBoundingClientRect().top > threshold) break;
		next = index;
	}
	activeIndex.value = next;
}

let frame = null;
function scheduleUpdateActive() {
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = null;
		updateActive();
	});
}

function goTo(entry, { collapse = false } = {}) {
	const element = headingElement(entry.pos);
	if (!element || !scrollContainer) return;
	// scrollIntoView would tuck the heading under the sticky toolbar, so scroll
	// the container by hand and leave room for it.
	const top =
		element.getBoundingClientRect().top -
		scrollContainer.getBoundingClientRect().top +
		scrollContainer.scrollTop -
		toolbarHeight.value -
		16;
	scrollContainer.scrollTo({ top, behavior: 'smooth' });
	if (collapse) open.value = false;
}

onMounted(() => {
	scrollContainer = findScrollContainer(rootRef.value);
	// Registered by hand rather than with useEventListener: the component's
	// effect scope is no longer active inside a lifecycle hook, so the
	// composable's auto-dispose wouldn't fire.
	scrollContainer?.addEventListener('scroll', scheduleUpdateActive, {
		passive: true,
	});
	nextTick(() => {
		measureToolbar();
		updateActive();
	});
});

onBeforeUnmount(() => {
	scrollContainer?.removeEventListener('scroll', scheduleUpdateActive);
	if (frame) cancelAnimationFrame(frame);
});

useEventListener(window, 'resize', () => {
	measureToolbar();
	scheduleUpdateActive();
});

// Editing above the current heading shifts every position below it; re-run the
// spy so the highlight tracks the caret's section rather than a stale one.
watch(outline, () => {
	if (activeIndex.value >= outline.value.length) {
		activeIndex.value = Math.max(0, outline.value.length - 1);
	}
	scheduleUpdateActive();
});
</script>

<style scoped>
.hide-scrollbar {
	scrollbar-width: none;
}
.hide-scrollbar::-webkit-scrollbar {
	display: none;
}
</style>
