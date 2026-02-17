<template>
    <div class="relative" ref="dropdownRef">
        <button
            class="flex items-center gap-1 h-8 px-2 border-0 rounded-md bg-transparent text-ink-gray-7 cursor-pointer transition-all duration-150 hover:bg-surface-gray-2"
            @mousedown.prevent
            @click="open = !open"
            title="Table"
        >
            <TableIcon class="size-4" />
            <ChevronDown class="size-3" />
        </button>
        <div
            v-show="open"
            class="absolute top-full left-0 mt-1 p-1 min-w-[200px] max-h-[400px] overflow-y-auto bg-surface-white border border-outline-gray-2 rounded-lg shadow-md z-50"
        >
            <button
                class="flex items-center gap-2 w-full px-3 py-2 border-0 rounded-md bg-transparent text-ink-gray-7 text-sm text-left cursor-pointer transition-all duration-150 hover:bg-surface-gray-2"
                @mousedown.prevent
                @click="insertTable"
            >
                <TableIcon class="size-4" />
                <span>Insert Table</span>
            </button>
            <template v-if="editor.isActive('table')">
                <template v-for="(item, index) in tableActions" :key="index">
                    <div v-if="item.divider" class="h-px bg-surface-gray-3 my-1"></div>
                    <button
                        v-else
                        class="flex items-center gap-2 w-full px-3 py-2 border-0 rounded-md bg-transparent text-sm text-left cursor-pointer transition-all duration-150"
                     :class="[
                                item.danger
                                    ? 'text-ink-red-4 hover:bg-surface-gray-2'
                                    : 'text-ink-gray-7 hover:bg-surface-gray-2',
                                { 'opacity-40 pointer-events-none': item.disabled() }
                            ]"
                        :disabled="item.disabled()"
                        @mousedown.prevent
                        @click="runAction(item.command)"
                    >
                        <span>{{ item.label }}</span>
                    </button>
                </template>
            </template>
        </div>
    </div>
</template>

<script setup>
import { ChevronDown, LucideTable as TableIcon } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
    editor: { type: Object, required: true },
});

const open = ref(false);
const dropdownRef = ref(null);

const tableActions = computed(() => [
    { divider: true },
    { label: 'Add Column Before', command: 'addColumnBefore', disabled: () => !props.editor.can().addColumnBefore() },
    { label: 'Add Column After', command: 'addColumnAfter', disabled: () => !props.editor.can().addColumnAfter() },
    { label: 'Delete Column', command: 'deleteColumn', disabled: () => !props.editor.can().deleteColumn() },
     { divider: true },
    { label: 'Add Row Before', command: 'addRowBefore', disabled: () => !props.editor.can().addRowBefore() },
    { label: 'Add Row After', command: 'addRowAfter', disabled: () => !props.editor.can().addRowAfter() },
    { label: 'Delete Row', command: 'deleteRow', disabled: () => !props.editor.can().deleteRow() },
     { divider: true },
    { label: 'Delete Table', command: 'deleteTable', danger: true, disabled: () => !props.editor.can().deleteTable() },
]);

function insertTable() {
    props.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    open.value = false;
}

function runAction(command) {
    props.editor.chain().focus()[command]().run();
    open.value = false;
}

function handleClickOutside(event) {
    if (dropdownRef.value && !dropdownRef.value.contains(event.target)) {
        open.value = false;
    }
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => document.removeEventListener('click', handleClickOutside));
</script>
