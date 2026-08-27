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
import { Button, Dropdown } from 'frappe-ui';
import { computed } from 'vue';
import { DEFAULT_TITLES } from './callout-markdown.js';

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
	getPos: {
		type: Function,
		required: true,
	},
});

// Normalize warning to caution
const normalizedType = computed(() => {
	const type = props.node.attrs.type || 'note';
	return type === 'warning' ? 'caution' : type;
});

const defaultTitle = computed(
	() => DEFAULT_TITLES[normalizedType.value] || 'Note',
);

// Display title (custom or default)
const displayTitle = computed(
	() => props.node.attrs.title || defaultTitle.value,
);

// The frappe-ui Alert status glyphs (icon/solid/* in Figma), inlined: the four
// SFCs behind `solidStatusIcons` are not exported from frappe-ui/icons, and the
// server-rendered reader needs the same paths in markdown.py anyway.
const icons = {
	note: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM8 6.93652C7.72386 6.93652 7.5 7.16038 7.5 7.43652V11.1436C7.50005 11.4197 7.72389 11.6436 8 11.6436C8.27611 11.6436 8.49995 11.4197 8.5 11.1436V7.43652C8.5 7.16038 8.27614 6.93652 8 6.93652ZM8 4C7.51675 4 7.125 4.39175 7.125 4.875C7.125 5.35825 7.51675 5.75 8 5.75C8.48325 5.75 8.875 5.35825 8.875 4.875C8.875 4.39175 8.48325 4 8 4Z" fill="currentColor"/></svg>`,
	tip: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM11.1055 5.28125C10.8924 5.10562 10.5771 5.13567 10.4014 5.34863L6.95215 9.53223L5.61035 7.79883C5.44143 7.58051 5.12757 7.54022 4.90918 7.70898C4.69088 7.8779 4.65061 8.19177 4.81934 8.41016L6.54395 10.6396C6.63696 10.7598 6.77972 10.8306 6.93164 10.833C7.08364 10.8354 7.22849 10.7687 7.3252 10.6514L11.1729 5.98438C11.3481 5.77144 11.3181 5.45689 11.1055 5.28125Z" fill="currentColor"/></svg>`,
	caution: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.35174 1.97129C7.64143 1.47669 8.35697 1.47669 8.64666 1.97129L15.0519 12.9078C15.3447 13.4077 14.9847 14.0365 14.4055 14.0367H1.59295C1.0138 14.0364 0.653701 13.4077 0.946469 12.9078L7.35174 1.97129ZM7.9992 10.4117C7.51609 10.4118 7.12433 10.8036 7.1242 11.2867C7.1242 11.7699 7.51601 12.1617 7.9992 12.1617C8.48245 12.1617 8.8742 11.77 8.8742 11.2867C8.87408 10.8036 8.48238 10.4117 7.9992 10.4117ZM8.00018 5.50742C7.72411 5.50742 7.5003 5.73139 7.50018 6.00742V9.25742C7.50018 9.53356 7.72404 9.75742 8.00018 9.75742C8.27615 9.75723 8.50018 9.53344 8.50018 9.25742V6.00742C8.50006 5.73151 8.27608 5.50762 8.00018 5.50742Z" fill="currentColor"/></svg>`,
	danger: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM10.8535 5.14648C10.6583 4.95122 10.3417 4.95122 10.1465 5.14648L8 7.29297L5.85352 5.14648C5.65825 4.95122 5.34175 4.95122 5.14648 5.14648C4.95122 5.34175 4.95122 5.65825 5.14648 5.85352L7.29297 8L5.14648 10.1465C4.95122 10.3417 4.95122 10.6583 5.14648 10.8535C5.34175 11.0488 5.65825 11.0488 5.85352 10.8535L8 8.70703L10.1465 10.8535C10.3417 11.0488 10.6583 11.0488 10.8535 10.8535C11.0488 10.6583 11.0488 10.3417 10.8535 10.1465L8.70703 8L10.8535 5.85352C11.0488 5.65825 11.0488 5.34175 10.8535 5.14648Z" fill="currentColor"/></svg>`,
};

const icon = computed(() => icons[normalizedType.value] || icons.note);

// The title is an attribute, not content — a second content hole would need a
// second node type. An input keeps it editable in place without one, holding a
// real value the author can select and delete.
function setTitle(event) {
	props.updateAttributes({ title: event.target.value });
}

// The rendered page always prints a title, so an emptied one means "the default"
// rather than "no header" — say so as soon as the author leaves the field.
function restoreDefaultTitle(event) {
	if (!event.target.value.trim()) {
		props.updateAttributes({ title: defaultTitle.value });
	}
}

// Enter in the title moves into the body, the way Tab-to-next-field would.
function focusBody() {
	props.editor.commands.focus(props.getPos() + 1);
}

function changeType(newType) {
	// A title the author never touched follows the type; one they wrote stays.
	const keepsTitle = props.node.attrs.title !== defaultTitle.value;
	props.updateAttributes({
		type: newType,
		...(keepsTitle ? {} : { title: DEFAULT_TITLES[newType] || '' }),
	});
}

// Dropdown menu options
const dropdownOptions = computed(() => [
	{
		label: 'Remove',
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
        class="callout-block-wrapper group my-4 p-3 rounded-6 bg-surface-gray-1 relative flex flex-col"
        :class="`callout-${normalizedType}`"
    >
        <div class="flex items-center gap-1.5" contenteditable="false">
            <span class="shrink-0 flex items-center callout-icon" v-html="icon"></span>
            <input
                v-if="editor.isEditable"
                class="callout-title flex-1 min-w-0 bg-transparent border-none p-0 outline-none text-base-medium text-ink-gray-8 placeholder:text-ink-gray-5"
                :value="node.attrs.title"
                :placeholder="defaultTitle"
                aria-label="Callout title"
                @input="setTitle"
                @blur="restoreDefaultTitle"
                @keydown.enter.prevent="focusBody"
                @keydown.escape.prevent="$event.target.blur()"
            />
            <span v-else class="callout-title flex-1 text-base-medium text-ink-gray-8">{{ displayTitle }}</span>
            <Dropdown v-if="editor.isEditable" :options="dropdownOptions" align="end">
                <Button variant="ghost" size="sm" class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 callout-menu-btn">
                    <span class="lucide-more-horizontal size-3.5" aria-hidden="true" />
                </Button>
            </Dropdown>
        </div>

        <NodeViewContent class="callout-content mt-1" />
    </NodeViewWrapper>
</template>

<style scoped>
/* Alert's prefix box: a fixed 16px slot the glyph sits centred in. */
.callout-icon {
    width: 1rem;
    height: 1rem;
}

/* The body is document content now, so prose owns its typography — these
   override it back to Alert's description style, and drop the outer margins so
   the callout's own padding is the only gap. */
/* Aligned to the title, not the container: Alert's description is full-bleed,
   but Alert is a 384px status box with a one-line description (see its stories).
   At document width, with paragraphs and lists in the body, a full-bleed body
   leaves the header looking detached from what it labels. 1rem icon + 0.375rem
   gap = the title's left edge. */
.callout-content {
    padding-left: calc(1rem + 0.375rem);
}

.callout-content :deep(> *:first-child) {
    margin-top: 0;
}

.callout-content :deep(> *:last-child) {
    margin-bottom: 0;
}

.callout-content :deep(p) {
    color: var(--ink-gray-6);
    font-size: var(--text-base, 0.875rem);
    line-height: 1.5;
    letter-spacing: 0.02em;
}

/* Only the icon carries the type's colour — the surface stays neutral, the way
   frappe-ui's Alert does it. */
.callout-note .callout-icon {
    color: var(--ink-blue-5);
}

.callout-tip .callout-icon {
    color: var(--ink-green-5);
}

.callout-caution .callout-icon {
    color: var(--ink-amber-5);
}

.callout-danger .callout-icon {
    color: var(--ink-red-5);
}
</style>
