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
		<button
			v-for="(tab, index) in visibleTabs"
			:key="tab.key"
			role="tab"
			:aria-selected="tab.key === activeKey"
			:title="tab.title"
			:draggable="isDraggable(tab)"
			:data-tab-key="tab.key"
			class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2.5 text-base duration-300 ease-in-out"
			:class="[
				tab.key === activeKey
					? 'text-ink-gray-9'
					: 'text-ink-gray-5 hover:text-ink-gray-9',
				dragKey === tab.key ? 'opacity-40' : '',
				isDraggable(tab) ? 'cursor-grab active:cursor-grabbing' : '',
			]"
			@click="emit('select', tab.key)"
			@dragstart="onDragStart(tab, $event)"
			@dragover="onDragOver(index, $event)"
			@drop="onDrop"
			@dragend="onDragEnd"
		>
			<!-- Drop marker rides the leading or trailing edge of the tab being
			     hovered, so the landing spot is visible before the release. -->
			<span
				v-if="dropMarkerFor(index) === 'before'"
				class="absolute -left-2.5 inset-y-2 w-[2px] rounded-full bg-surface-gray-10"
			/>
			<span
				v-else-if="dropMarkerFor(index) === 'after'"
				class="absolute -right-2.5 inset-y-2 w-[2px] rounded-full bg-surface-gray-10"
			/>
			<SpaceIcon v-if="tab.icon" :icon="tab.icon" />
			<span>{{ tab.title }}</span>
			<span
				v-if="tab.key === activeKey"
				class="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-surface-gray-10"
			/>
		</button>

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
		<button
			v-if="canManageTabs"
			:title="__('New Tab')"
			:aria-label="__('New Tab')"
			data-testid="new-tab-button"
			class="flex shrink-0 items-center py-2.5 text-ink-gray-5 duration-300 ease-in-out hover:text-ink-gray-9"
			@click="emit('create')"
		>
			<span class="lucide-plus size-4" aria-hidden="true" />
		</button>
	</div>
</template>

<script setup>
import { Dropdown } from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { GENERAL_KEY } from '../lib/spaceTabs.js';
import SpaceIcon from './SpaceIcon.vue';

const props = defineProps({
	// [{ key, title, icon }] — `icon` is a full lucide class name, e.g. 'lucide-wallet'.
	tabs: { type: Array, default: () => [] },
	activeKey: { type: String, default: null },
	// Gates the add button and drag-reordering (mirrors the backend's
	// can_manage_tabs; enforcement stays server-side).
	canManageTabs: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'create', 'reorder']);

const container = ref(null);
const visibleCount = ref(0);

const visibleTabs = computed(() => props.tabs.slice(0, visibleCount.value));
const overflowTabs = computed(() => props.tabs.slice(visibleCount.value));

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

// Reorder. The General entry is synthetic — it stands for everything *not* in a
// tab, so it has no document to move and always trails the real tabs.
const dragKey = ref(null);
const dropIndex = ref(null);

function isDraggable(tab) {
	return props.canManageTabs && tab.key !== GENERAL_KEY;
}

function onDragStart(tab, event) {
	if (!isDraggable(tab)) {
		event.preventDefault();
		return;
	}
	dragKey.value = tab.key;
	event.dataTransfer.effectAllowed = 'move';
	// Firefox ignores a drag that carries no payload.
	event.dataTransfer.setData('text/plain', tab.key);
}

function onDragOver(index, event) {
	if (!dragKey.value) return;
	const tab = visibleTabs.value[index];
	// Dropping onto General means "last among the real tabs", which is where
	// the index below already lands.
	event.preventDefault();
	event.dataTransfer.dropEffect = 'move';

	const rect = event.currentTarget.getBoundingClientRect();
	const after = event.clientX > rect.left + rect.width / 2;
	dropIndex.value = tab.key === GENERAL_KEY ? index : index + (after ? 1 : 0);
}

// Which edge of tab `index` shows the marker, given the pending drop slot.
function dropMarkerFor(index) {
	if (dropIndex.value === null || !dragKey.value) return null;
	if (dropIndex.value === index) return 'before';
	if (dropIndex.value === index + 1 && index === visibleTabs.value.length - 1)
		return 'after';
	return null;
}

function onDrop(event) {
	event.preventDefault();
	const docKey = dragKey.value;
	const slot = dropIndex.value;
	if (!docKey || slot === null) return;

	// The bar's slot index counts every entry; the parent reorders among real
	// tabs only, and the dragged tab is pulled out of the list first — so drop
	// slots after its current position shift back by one.
	const tabsOnly = props.tabs.filter((tab) => tab.key !== GENERAL_KEY);
	const from = tabsOnly.findIndex((tab) => tab.key === docKey);
	const toIndex = Math.min(slot > from ? slot - 1 : slot, tabsOnly.length - 1);

	if (toIndex !== from) emit('reorder', { docKey, toIndex });
	onDragEnd();
}

function onDragEnd() {
	dragKey.value = null;
	dropIndex.value = null;
}

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
const ADD = 36; // the add button + its gap

function tabWidth(tab) {
	return GAP + (tab.icon ? ICON : 0) + tab.title.length * CHAR;
}

function measure() {
	const el = container.value;
	if (!el || !props.tabs.length) return;

	const available = el.clientWidth - (props.canManageTabs ? ADD : 0);
	const widths = props.tabs.map(tabWidth);
	const total = widths.reduce((sum, w) => sum + w, 0);

	if (total <= available) {
		visibleCount.value = props.tabs.length;
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
