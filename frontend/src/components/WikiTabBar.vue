<template>
	<!-- Styling mirrors frappe-ui's Tabs (TabsList / TabsTrigger / TabsIndicator):
	     gap-5 triggers, text-ink-gray-5 resting, text-ink-gray-9 active, and a
	     2px rounded surface-gray-10 indicator. Rebuilt rather than used directly
	     because these tabs need to be drag-reorderable and overflow into a More
	     menu, neither of which reka-ui's Tabs exposes. -->
	<div
		v-if="tabs.length"
		ref="container"
		class="relative flex min-w-0 flex-1 items-stretch gap-5 overflow-hidden"
		role="tablist"
	>
		<!-- Home leads the bar and never drags: it's synthetic (everything not in
		     a tab), so it has no document to reorder and stays pinned leftmost. -->
		<WikiTab
			v-if="homeTab"
			:tab="homeTab"
			:active="homeTab.key === activeKey"
			:can-manage="canManageTabs"
			@select="emit('select', homeTab.key)"
			@update-icon="emit('update-icon', { key: homeTab.key, icon: $event })"
			@rename="emit('rename-tab', { key: homeTab.key, title: $event })"
		/>

		<!-- The reorderable real tabs. SortableJS owns the drag; the group is its
		     own flex row so the container's gap-5 also spaces it against Home, the
		     More menu, and the add button. -->
		<div ref="sortableEl" class="flex items-stretch gap-5 empty:hidden">
			<WikiTab
				v-for="tab in sortableList"
				:key="tab.key"
				:tab="tab"
				:active="tab.key === activeKey"
				:can-manage="canManageTabs"
				:draggable="canManageTabs"
				@select="emit('select', tab.key)"
				@update-icon="emit('update-icon', { key: tab.key, icon: $event })"
				@rename="emit('rename-tab', { key: tab.key, title: $event })"
			/>
		</div>

		<!-- Overflow. When the active tab is inside it, the trigger takes on that
		     tab's name and indicator so the current section stays visible. -->
		<Dropdown v-if="overflowTabs.length" :options="overflowOptions">
			<button
				class="relative flex shrink-0 items-center gap-1 whitespace-nowrap py-2.5 text-base duration-300 ease-in-out"
				:class="
					activeInOverflow
						? 'text-ink-gray-9'
						: 'text-ink-gray-5 hover:text-ink-gray-9'
				"
			>
				<span>{{ activeInOverflow ? activeTab.title : __('More') }}</span>
				<span class="lucide-chevron-down size-4 shrink-0" aria-hidden="true" />
				<span
					v-if="activeInOverflow"
					class="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-surface-gray-10"
				/>
			</button>
		</Dropdown>

		<!-- Always last, and never collapsed into the overflow menu: creating a
		     tab is an action on the bar itself, not one of its entries. -->
		<Button
			v-if="canManageTabs"
			variant="ghost"
			:label="__('New Tab')"
			:title="__('New Tab')"
			data-testid="new-tab-button"
			class="shrink-0 self-center"
			@click="emit('create')"
		>
			<template #prefix>
				<span class="lucide-plus size-4" aria-hidden="true" />
			</template>
		</Button>
	</div>
</template>

<script setup>
import { Button, Dropdown } from 'frappe-ui';
import { useSortable } from '@vueuse/integrations/useSortable';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { GENERAL_KEY } from '../lib/spaceTabs.js';
import WikiTab from './WikiTab.vue';

const props = defineProps({
	// [{ key, title, icon }] — `icon` is a full lucide class name, e.g. 'lucide-wallet'.
	tabs: { type: Array, default: () => [] },
	activeKey: { type: String, default: null },
	// Gates the add button and drag-reordering (mirrors the backend's
	// can_manage_tabs; enforcement stays server-side).
	canManageTabs: { type: Boolean, default: false },
});

const emit = defineEmits([
	'select',
	'create',
	'reorder',
	'update-icon',
	'rename-tab',
]);

const container = ref(null);
const visibleCount = ref(0);

// Home is pinned; only the real (document-backed) tabs reorder and overflow.
const homeTab = computed(
	() => props.tabs.find((t) => t.key === GENERAL_KEY) || null,
);
const realTabs = computed(() => props.tabs.filter((t) => t.key !== GENERAL_KEY));

const visibleRealTabs = computed(() =>
	realTabs.value.slice(0, visibleCount.value),
);
const overflowTabs = computed(() => realTabs.value.slice(visibleCount.value));

const activeTab = computed(
	() => props.tabs.find((t) => t.key === props.activeKey) || null,
);
const activeInOverflow = computed(() =>
	overflowTabs.value.some((t) => t.key === props.activeKey),
);

const overflowOptions = computed(() =>
	overflowTabs.value.map((tab) => ({
		label: tab.title,
		onClick: () => emit('select', tab.key),
	})),
);

// Drag-reorder via SortableJS. `sortableList` is a mutable mirror of the visible
// real tabs: useSortable moves an entry within it on drop (keeping the DOM in
// step with Vue), and we forward the new order to the parent, which persists it
// and re-derives `tabs` — resyncing the mirror.
const sortableEl = ref(null);
const sortableList = ref([]);

watch(
	visibleRealTabs,
	(tabs) => {
		sortableList.value = tabs.slice();
	},
	{ immediate: true, deep: true },
);

const { option: setSortableOption } = useSortable(sortableEl, sortableList, {
	animation: 200,
	// The bar mounts before tabs load (they arrive async), so the sortable target
	// doesn't exist yet at mount — watch the ref and initialise once it appears.
	watchElement: true,
	// Pointer-driven fallback rather than native HTML5 DnD: consistent visuals
	// across browsers, and reliably drivable by real mouse-move sequences.
	forceFallback: true,
	ghostClass: 'opacity-40',
	disabled: !props.canManageTabs,
	onEnd(event) {
		const { oldIndex, newIndex } = event;
		if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
		// useSortable's default onUpdate splices the mirror on nextTick, so at
		// onEnd it still holds the pre-drag order — read the dragged tab by its
		// original index. Slot index counts real tabs only, which is what the
		// parent reorders over.
		const moved = sortableList.value[oldIndex];
		if (moved) emit('reorder', { docKey: moved.key, toIndex: newIndex });
	},
});

watch(
	() => props.canManageTabs,
	(can) => setSortableOption('disabled', !can),
);

// How many tabs fit is measured off the bar's own width rather than a viewport
// breakpoint, because the editor's sidebar is user-resizable and the reader's
// header shares its row with the search field. Widths are estimated instead of
// measured: the rendered row's width is itself a function of visibleCount, so
// measuring it would oscillate between counts.
let observer = null;

const GAP = 20; // gap-5 between triggers
const ICON = 16 + 6; // icon + gap-1.5
const CHAR = 7.2; // average label character
const MORE = 76; // "More" + chevron
const ADD = 120; // the "New Tab" ghost button + its gap

function tabWidth(tab) {
	return GAP + (tab.icon ? ICON : 0) + tab.title.length * CHAR;
}

function measure() {
	const el = container.value;
	if (!el || !props.tabs.length) return;

	// Home is always shown and the add button is always reserved; only the real
	// tabs compete for the leftover width.
	const reserved =
		(homeTab.value ? tabWidth(homeTab.value) : 0) +
		(props.canManageTabs ? ADD : 0);
	const available = el.clientWidth - reserved;
	const widths = realTabs.value.map(tabWidth);
	const total = widths.reduce((sum, w) => sum + w, 0);

	if (total <= available) {
		visibleCount.value = realTabs.value.length;
		return;
	}

	let used = 0;
	let count = 0;
	for (const width of widths) {
		if (used + width > available - MORE) break;
		used += width;
		count += 1;
	}
	// Always keep at least one real tab next to the overflow trigger.
	visibleCount.value = Math.max(1, count);
}

onMounted(() => {
	measure();
	if (typeof ResizeObserver === 'undefined') return;
	observer = new ResizeObserver(measure);
	if (container.value) observer.observe(container.value);
});

watch(() => props.tabs, measure, { deep: true });
watch(() => props.canManageTabs, measure);

onBeforeUnmount(() => observer?.disconnect());
</script>
