<template>
    <!-- Mirrors frappe-ui's slash menu (SuggestionList + EditorPopover classes)
         so the wiki editor matches Gameplan: compact rows, section headers per
         consecutive `group` run, icon + title only. -->
    <div
        class="slash-commands-list relative max-h-[300px] min-w-48 overflow-y-auto rounded-lg border border-outline-gray-2 bg-surface-elevation-2 p-1 text-base shadow-2xl"
    >
        <template v-if="items.length">
            <template
                v-for="(group, groupIndex) in groupedItems"
                :key="group.label ?? groupIndex"
            >
                <div
                    v-if="group.label"
                    class="flex h-7 items-center px-2 text-sm-medium text-ink-gray-4"
                >
                    {{ group.label }}
                </div>
                <button
                    v-for="{ item, index } in group.entries"
                    :key="item.title"
                    :ref="(el) => setItemRef(el, index)"
                    type="button"
                    class="flex h-11 w-full items-center whitespace-nowrap rounded px-2 py-1.5 text-sm text-ink-gray-9 sm:h-7"
                    :class="index === selectedIndex ? 'bg-surface-gray-2' : ''"
                    @click="selectItem(index)"
                    @mouseover="selectedIndex = index"
                >
                    <span :class="item.icon" class="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>{{ item.title }}</span>
                </button>
            </template>
        </template>
        <div
            v-else
            class="slash-commands-empty px-3 py-1.5 text-sm text-ink-gray-5"
        >
            No commands found
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUpdate, ref, watch } from 'vue';

const props = defineProps({
	items: {
		type: Array,
		required: true,
	},
	command: {
		type: Function,
		required: true,
	},
});

const selectedIndex = ref(0);
const itemRefs = ref([]);

// Display-only grouping: consecutive runs of `item.group` share one header,
// keeping each item's ORIGINAL index so flat keyboard selection maps 1:1.
// filterCommands preserves source order, so groups stay adjacent and empty
// groups never appear. (Same idiom as frappe-ui's SuggestionList.)
const groupedItems = computed(() => {
	const groups = [];
	props.items.forEach((item, index) => {
		const label = typeof item.group === 'string' ? item.group : undefined;
		const last = groups[groups.length - 1];
		if (last && last.label === label) last.entries.push({ item, index });
		else groups.push({ label, entries: [{ item, index }] });
	});
	return groups;
});

onBeforeUpdate(() => {
	itemRefs.value = [];
});

function setItemRef(el, index) {
	if (el instanceof HTMLElement) itemRefs.value[index] = el;
}

function selectItem(index) {
	const item = props.items[index];
	if (item) {
		props.command(item);
	}
}

function scrollSelectedIntoView() {
	nextTick(() => {
		itemRefs.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' });
	});
}

function onKeyDown(event) {
	if (event.key === 'ArrowUp') {
		event.preventDefault();
		selectedIndex.value =
			(selectedIndex.value - 1 + props.items.length) % props.items.length;
		scrollSelectedIntoView();
		return true;
	}
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
		scrollSelectedIntoView();
		return true;
	}
	if (event.key === 'Enter') {
		event.preventDefault();
		selectItem(selectedIndex.value);
		return true;
	}
	return false;
}

// Reset selected index when items change
watch(
	() => props.items,
	() => {
		selectedIndex.value = 0;
	},
);

// Expose onKeyDown for parent component
defineExpose({
	onKeyDown,
});
</script>
