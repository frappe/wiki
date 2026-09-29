<template>
    <div
        class="w-[340px] overflow-hidden rounded-5 border border-outline-gray-2 bg-surface-elevation-2 text-ink-gray-9 shadow-xl"
        role="listbox"
        aria-label="Link to a page"
    >
        <div class="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-xs text-ink-gray-5">
            <span class="lucide-link-2 size-3.5" aria-hidden="true" />
            <span v-if="trimmedQuery" class="truncate">Link to “{{ trimmedQuery }}”</span>
            <span v-else>Link to a page</span>
        </div>

        <div class="max-h-72 overflow-y-auto p-1.5 pt-0.5">
            <p v-if="!hasPages" class="page-links-empty px-2 py-2 text-sm text-ink-gray-5">
                No page matches.
            </p>

            <!-- mousedown, not click: the editor must keep focus, or the caret
                 and the typed trigger are gone before the link goes in. -->
            <button
                v-for="(item, index) in items"
                :key="item.key"
                :ref="(el) => (itemRefs[index] = el)"
                type="button"
                role="option"
                :aria-selected="index === selectedIndex"
                class="flex w-full items-center gap-2.5 rounded-4 px-2 py-1.5 text-left"
                :class="[
                    index === selectedIndex ? 'bg-surface-gray-3' : '',
                    item.create && hasPages ? 'mt-1' : '',
                ]"
                @mousedown.prevent="command(item)"
                @mousemove="selectedIndex = index"
            >
                <template v-if="item.create">
                    <span class="lucide-file-plus size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate text-base text-ink-gray-7">
                        Create <span class="font-semibold text-ink-gray-9">“{{ item.title }}”</span>
                    </span>
                </template>
                <template v-else>
                    <span class="lucide-file-text size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                        <span class="flex items-center gap-1.5">
                            <span class="truncate text-base text-ink-gray-7">
                                <span
                                    v-for="(part, partIndex) in highlight(item.title)"
                                    :key="partIndex"
                                    :class="part.match ? 'font-semibold text-ink-gray-9' : ''"
                                >{{ part.text }}</span>
                            </span>
                            <span v-if="!item.isPublished" class="shrink-0 text-2xs text-ink-gray-5">
                                Unpublished
                            </span>
                        </span>
                        <span class="block truncate text-xs text-ink-gray-5">
                            {{ item.trail.join(' / ') || spaceName }}
                        </span>
                    </span>
                </template>
                <span
                    v-if="index === selectedIndex"
                    class="lucide-corner-down-left size-3.5 shrink-0 text-ink-gray-5"
                    aria-hidden="true"
                />
            </button>
        </div>

        <div class="flex items-center gap-3 border-t border-outline-gray-1 px-3 py-1.5 text-2xs text-ink-gray-5">
            <span>↑↓ to move</span>
            <span>↵ to link</span>
            <span>esc to close</span>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
	items: { type: Array, required: true },
	command: { type: Function, required: true },
	query: { type: String, default: '' },
	// Shown under a page that sits at the top of the space, outside any folder.
	spaceName: { type: String, default: '' },
});

const selectedIndex = ref(0);
const itemRefs = ref([]);
const trimmedQuery = computed(() => props.query.trim());
const hasPages = computed(() => props.items.some((item) => !item.create));

watch(
	() => props.items,
	() => {
		selectedIndex.value = 0;
	},
);

watch(selectedIndex, () =>
	nextTick(() =>
		itemRefs.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' }),
	),
);

function highlight(title) {
	const query = trimmedQuery.value;
	const at = query ? title.toLowerCase().indexOf(query.toLowerCase()) : -1;
	if (at === -1) return [{ text: title, match: false }];
	return [
		{ text: title.slice(0, at), match: false },
		{ text: title.slice(at, at + query.length), match: true },
		{ text: title.slice(at + query.length), match: false },
	].filter((part) => part.text);
}

function onKeyDown(event) {
	const count = props.items.length;
	if (!count) return false;
	if (event.key === 'ArrowDown') {
		selectedIndex.value = (selectedIndex.value + 1) % count;
	} else if (event.key === 'ArrowUp') {
		selectedIndex.value = (selectedIndex.value - 1 + count) % count;
	} else if (event.key === 'Enter' || event.key === 'Tab') {
		props.command(props.items[selectedIndex.value]);
	} else {
		return false;
	}
	event.preventDefault();
	return true;
}

defineExpose({ onKeyDown });
</script>
