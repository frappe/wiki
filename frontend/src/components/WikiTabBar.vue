<template>
	<div
		v-if="tabs.length"
		ref="container"
		class="shrink-0 border-b border-outline-gray-2 px-2 py-1.5"
	>
		<!-- Too narrow even for icons: the active tab becomes a dropdown trigger. -->
		<Dropdown v-if="mode === 'dropdown'" :options="dropdownOptions">
			<button
				class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-base-medium text-ink-gray-8 hover:bg-surface-gray-2"
				:title="__('Switch section')"
			>
				<SpaceIcon
					v-if="activeTab?.icon"
					:icon="activeTab.icon"
					class="shrink-0 text-ink-gray-7"
				/>
				<span class="truncate">{{ activeTab?.title || __('Sections') }}</span>
				<span
					class="lucide-chevrons-up-down ml-auto size-4 shrink-0 text-ink-gray-5"
					aria-hidden="true"
				/>
			</button>
		</Dropdown>

		<!-- Otherwise a real horizontal row; labels drop out before the row does. -->
		<div v-else class="flex items-center gap-1 overflow-hidden" role="tablist">
			<button
				v-for="tab in tabs"
				:key="tab.key"
				role="tab"
				:aria-selected="tab.key === activeKey"
				:aria-label="tab.title"
				:title="tab.title"
				class="flex min-w-0 shrink items-center justify-center gap-1.5 rounded px-2 py-1 text-base-medium transition-colors"
				:class="
					tab.key === activeKey
						? 'bg-surface-gray-3 text-ink-gray-9'
						: 'text-ink-gray-6 hover:bg-surface-gray-2 hover:text-ink-gray-8'
				"
				@click="emit('select', tab.key)"
			>
				<SpaceIcon v-if="tab.icon" :icon="tab.icon" class="shrink-0" />
				<span
					v-if="mode === 'full' || tab.key === activeKey"
					class="truncate"
					>{{ tab.title }}</span
				>
			</button>
		</div>
	</div>
</template>

<script setup>
import { Dropdown } from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import SpaceIcon from './SpaceIcon.vue';

const props = defineProps({
	// [{ key, title, icon }] — `icon` is a full lucide class name, e.g. 'lucide-wallet'.
	tabs: { type: Array, default: () => [] },
	activeKey: { type: String, default: null },
});

const emit = defineEmits(['select']);

const container = ref(null);
// 'full' = icon + label, 'icons' = icon only, 'dropdown' = collapsed.
const mode = ref('full');

const activeTab = computed(
	() => props.tabs.find((t) => t.key === props.activeKey) || null,
);

const dropdownOptions = computed(() =>
	props.tabs.map((tab) => ({
		label: tab.title,
		onClick: () => emit('select', tab.key),
	})),
);

// The sidebar is user-resizable, so this keys off the bar's own width rather
// than a viewport media query. Widths are estimated instead of measured: the
// row's real width changes as a result of `mode`, so measuring it would
// oscillate between tiers.
let observer = null;

const GAP = 4;
const BUTTON_PADDING = 16;
const ICON_WIDTH = 16;
const CHAR_WIDTH = 7;

function measure() {
	const el = container.value;
	if (!el || !props.tabs.length) return;

	const available = el.clientWidth - 16; // container px-2
	const gaps = GAP * Math.max(0, props.tabs.length - 1);

	// Budgets icons only. In 'icons' mode the active tab also shows its label,
	// but that label is free to truncate, so it can't force a collapse.
	const iconsOnly =
		gaps +
		props.tabs.reduce(
			(total, tab) => total + BUTTON_PADDING + (tab.icon ? ICON_WIDTH : 24),
			0,
		);
	if (iconsOnly > available) {
		mode.value = 'dropdown';
		return;
	}

	const full =
		gaps +
		props.tabs.reduce(
			(total, tab) =>
				total +
				BUTTON_PADDING +
				(tab.icon ? ICON_WIDTH + GAP + 2 : 0) +
				tab.title.length * CHAR_WIDTH,
			0,
		);
	mode.value = full > available ? 'icons' : 'full';
}

onMounted(() => {
	measure();
	if (typeof ResizeObserver === 'undefined') return;
	observer = new ResizeObserver(measure);
	if (container.value) observer.observe(container.value);
});

watch(() => props.tabs, measure, { deep: true });

onBeforeUnmount(() => observer?.disconnect());
</script>
