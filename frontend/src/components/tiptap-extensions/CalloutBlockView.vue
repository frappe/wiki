<script setup>
/**
 * CalloutBlockView Component
 *
 * Renders a callout/aside block in the TipTap editor.
 * Supports types: note, tip, caution, danger
 *
 * The body is a `<NodeViewContent>` hole — the main editor owns it, so bold,
 * italic, links, lists, headings and code blocks all work inside a callout
 * with no editor of this component's own.
 */

import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { Button, Dialog, Dropdown, TextInput } from 'frappe-ui';
import { computed, ref } from 'vue';

const props = defineProps({
	node: {
		type: Object,
		required: true,
	},
	updateAttributes: {
		type: Function,
		required: true,
	},
	deleteNode: {
		type: Function,
		required: true,
	},
	editor: {
		type: Object,
		required: true,
	},
});

// Normalize warning to caution
const normalizedType = computed(() => {
	const type = props.node.attrs.type || 'note';
	return type === 'warning' ? 'caution' : type;
});

// Default titles for each type
const defaultTitles = {
	note: 'Note',
	tip: 'Tip',
	caution: 'Caution',
	danger: 'Danger',
};

// Display title (custom or default)
const displayTitle = computed(() => {
	return (
		props.node.attrs.title || defaultTitles[normalizedType.value] || 'Note'
	);
});

// SVG icons for each callout type
const icons = {
	note: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
	tip: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
	caution: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
	danger: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
};

const icon = computed(() => icons[normalizedType.value] || icons.note);

// Title editing dialog
const showTitleDialog = ref(false);
const editingTitle = ref('');

function openTitleDialog() {
	editingTitle.value = props.node.attrs.title || '';
	showTitleDialog.value = true;
}

function saveTitle() {
	props.updateAttributes({ title: editingTitle.value });
	showTitleDialog.value = false;
}

function changeType(newType) {
	props.updateAttributes({ type: newType });
}

// Dropdown menu options
const dropdownOptions = computed(() => [
	{
		label: 'Edit Title',
		icon: 'lucide-pencil',
		onClick: openTitleDialog,
	},
	{
		label: 'Delete',
		icon: 'lucide-trash-2',
		onClick: () => props.deleteNode(),
	},
	{
		group: 'Type',
		hideLabel: true,
		items: [
			{
				label: 'Note',
				icon: 'lucide-info',
				onClick: () => changeType('note'),
			},
			{
				label: 'Tip',
				icon: 'lucide-lightbulb',
				onClick: () => changeType('tip'),
			},
			{
				label: 'Caution',
				icon: 'lucide-triangle-alert',
				onClick: () => changeType('caution'),
			},
			{
				label: 'Danger',
				icon: 'lucide-shield-alert',
				onClick: () => changeType('danger'),
			},
		],
	},
]);
</script>

<template>
    <NodeViewWrapper
        class="callout-block-wrapper group my-4 px-4 py-3.5 rounded-5 relative flex flex-col gap-2"
        :class="`callout-${normalizedType}`"
    >
        <div class="flex items-center gap-2" contenteditable="false">
            <span class="shrink-0 flex items-center callout-icon" v-html="icon"></span>
            <span class="flex-1 text-sm-medium leading-[1.4] text-ink-gray-9">{{ displayTitle }}</span>
            <Dropdown v-if="editor.isEditable" :options="dropdownOptions" align="end">
                <Button variant="ghost" size="sm" class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 callout-menu-btn">
                    <span class="lucide-more-horizontal size-3.5" aria-hidden="true" />
                </Button>
            </Dropdown>
        </div>

        <NodeViewContent class="callout-content text-sm leading-normal text-ink-gray-7" />

        <!-- Title Edit Dialog -->
        <Dialog v-model:open="showTitleDialog" title="Edit Callout Title">
            <template #default>
                <div class="space-y-4">
                    <TextInput
                        v-model="editingTitle"
                        label="Title"
                        placeholder="Leave empty for default title"
                        @keydown.enter="saveTitle"
                    />
                    <p class="text-sm text-ink-gray-5">
                        Default title: {{ defaultTitles[normalizedType] }}
                    </p>
                </div>
            </template>
            <template #actions>
                <Button variant="solid" @click="saveTitle">Save</Button>
            </template>
        </Dialog>
    </NodeViewWrapper>
</template>

<style scoped>
/* Icon sizing */
.callout-icon :deep(svg) {
    width: 1rem;
    height: 1rem;
}

/* The body is document content now: kill the block margins prose gives its
   first and last child so the callout keeps its own padding. */
.callout-content :deep(> *:first-child) {
    margin-top: 0;
}

.callout-content :deep(> *:last-child) {
    margin-bottom: 0;
}

/* Callout type colors - these use CSS variables that don't map to Tailwind */
.callout-note {
    background-color: var(--surface-blue-2, #dbeafe);
}
.callout-note .callout-icon {
    color: var(--ink-blue-5, #2563eb);
}

.callout-tip {
    background-color: var(--surface-green-2, #dcfce7);
}
.callout-tip .callout-icon {
    color: var(--ink-green-5, #16a34a);
}

.callout-caution {
    background-color: var(--surface-amber-2, #fef3c7);
}
.callout-caution .callout-icon {
    color: var(--ink-amber-5, #d97706);
}

.callout-danger {
    background-color: var(--surface-red-2, #fecaca);
}
.callout-danger .callout-icon {
    color: var(--ink-red-5, #dc2626);
}
</style>
