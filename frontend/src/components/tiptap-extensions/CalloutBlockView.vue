<script setup>
/**
 * CalloutBlockView Component
 *
 * Renders a callout/aside block in the TipTap editor.
 * Supports types: note, tip, caution, danger
 */

import { computed, ref, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { NodeViewWrapper } from '@tiptap/vue-3';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { WikiLink } from './link-extension.js';
import { Dropdown, Button, Dialog, Input } from 'frappe-ui';
import LucideMoreHorizontal from '~icons/lucide/more-horizontal';
import LucideInfo from '~icons/lucide/info';
import LucideLightbulb from '~icons/lucide/lightbulb';
import LucideTriangleAlert from '~icons/lucide/triangle-alert';
import LucideShieldAlert from '~icons/lucide/shield-alert';
import LucidePencil from '~icons/lucide/pencil';
import LucideEyeOff from '~icons/lucide/eye-off';
import LucideEye from '~icons/lucide/eye';

const props = defineProps({
    node: {
        type: Object,
        required: true,
    },
    updateAttributes: {
        type: Function,
        required: true,
    },
    selected: {
        type: Boolean,
        default: false,
    },
    deleteNode: {
        type: Function,
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

// Whether title is hidden
const isTitleHidden = computed(() => props.node.attrs.hideTitle);

// Display title (custom or default)
const displayTitle = computed(() => {
    return props.node.attrs.title || defaultTitles[normalizedType.value] || 'Note';
});

// SVG icons for each callout type
const icons = {
    note: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    tip: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
    caution: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    danger: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
};

const icon = computed(() => icons[normalizedType.value] || icons.note);

// Editing state
const isEditingContent = ref(false);
const contentEditor = ref(null);
let isSaving = false;

// Render content as HTML for read mode
const renderedContent = computed(() => {
    const content = props.node.attrs.content || '';
    if (!content) return '';
    // Simple markdown to HTML for display: bold, italic, links
    return content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
});

// Watch for external changes
watch(
    () => props.node.attrs.content,
    (newContent) => {
        if (!isEditingContent.value && contentEditor.value) {
            // Not editing, no action needed (read mode uses computed)
        }
    }
);

function createMiniEditor(content) {
    return new Editor({
        extensions: [
            StarterKit.configure({
                // Only keep basic inline formatting
                heading: false,
                blockquote: false,
                bulletList: false,
                orderedList: false,
                listItem: false,
                codeBlock: false,
                horizontalRule: false,
            }),
            WikiLink.configure({
                openOnClick: false,
                autolink: false,
                linkOnPaste: false,
            }),
            Markdown,
        ],
        content,
        contentType: 'markdown',
        editorProps: {
            attributes: {
                class: 'callout-mini-prosemirror',
            },
        },
    });
}

function startEditing() {
    const md = props.node.attrs.content || '';
    contentEditor.value = createMiniEditor(md);
    isEditingContent.value = true;
}

function getMarkdown() {
    if (!contentEditor.value) return props.node.attrs.content || '';
    return contentEditor.value.storage.markdown.getMarkdown();
}

function syncContent() {
    const md = getMarkdown();
    if (md !== props.node.attrs.content) {
        props.updateAttributes({ content: md });
    }
}

function finishEditing() {
    if (isSaving) return;
    syncContent();
    isEditingContent.value = false;
    if (contentEditor.value) {
        contentEditor.value.destroy();
        contentEditor.value = null;
    }
}

// Sync content before save so pending edits are not lost
function handleBeforeSave() {
    if (isEditingContent.value) {
        isSaving = true;
        syncContent();
    }
}

// Re-focus editor after save completes
function handleAfterSave() {
    if (isSaving) {
        isSaving = false;
        nextTick(() => {
            contentEditor.value?.commands.focus();
        });
    }
}

onMounted(() => {
    document.addEventListener('wiki-editor-before-save', handleBeforeSave);
    document.addEventListener('wiki-editor-after-save', handleAfterSave);

    // Auto-enter edit mode for new callouts (empty content)
    if (!props.node.attrs.content) {
        startEditing();
    }
});

onUnmounted(() => {
    document.removeEventListener('wiki-editor-before-save', handleBeforeSave);
    document.removeEventListener('wiki-editor-after-save', handleAfterSave);
    if (contentEditor.value) {
        contentEditor.value.destroy();
        contentEditor.value = null;
    }
});

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

function toggleTitle() {
    props.updateAttributes({ hideTitle: !props.node.attrs.hideTitle });
}

// Dropdown menu options
const dropdownOptions = computed(() => [
    ...(isTitleHidden.value
        ? [{
            label: 'Add Title',
            icon: LucideEye,
            onClick: toggleTitle,
        }]
        : [
            {
                label: 'Edit Title',
                icon: LucidePencil,
                onClick: openTitleDialog,
            },
            {
                label: 'Remove Title',
                icon: LucideEyeOff,
                onClick: toggleTitle,
            },
        ]
    ),
    {
        label: 'Delete',
        icon: 'trash-2',
        onClick: () => props.deleteNode(),
    },
    {
        group: 'Type',
        hideLabel: true,
        items: [
            {
                label: 'Note',
                icon: LucideInfo,
                onClick: () => changeType('note'),
            },
            {
                label: 'Tip',
                icon: LucideLightbulb,
                onClick: () => changeType('tip'),
            },
            {
                label: 'Caution',
                icon: LucideTriangleAlert,
                onClick: () => changeType('caution'),
            },
            {
                label: 'Danger',
                icon: LucideShieldAlert,
                onClick: () => changeType('danger'),
            },
        ],
    },
]);
</script>

<template>
    <NodeViewWrapper
        class="callout-block-wrapper"
        :class="[`callout-${normalizedType}`, { 'is-selected': selected }]"
        contenteditable="false"
    >
        <!-- With title: header row + content row -->
        <template v-if="!isTitleHidden">
            <div class="callout-header">
                <span class="callout-icon" v-html="icon"></span>
                <span class="callout-title-text">{{ displayTitle }}</span>
                <Dropdown :options="dropdownOptions" placement="bottom-end">
                    <Button variant="ghost" size="sm" class="callout-menu-btn">
                        <LucideMoreHorizontal class="size-3.5" />
                    </Button>
                </Dropdown>
            </div>
            <div class="callout-content" @dblclick="!isEditingContent && startEditing()">
                <template v-if="isEditingContent && contentEditor">
                    <EditorContent :editor="contentEditor" class="callout-mini-editor" />
                </template>
                <div
                    v-else
                    class="callout-content-text prose prose-sm"
                    v-html="renderedContent || 'Double-click to edit...'"
                ></div>
            </div>
        </template>

        <!-- Without title: icon + content inline (matches public page layout) -->
        <template v-else>
            <div class="callout-inline">
                <span class="callout-icon" v-html="icon"></span>
                <div class="callout-content callout-content-inline" @dblclick="!isEditingContent && startEditing()">
                    <template v-if="isEditingContent && contentEditor">
                        <EditorContent :editor="contentEditor" class="callout-mini-editor" />
                    </template>
                    <div
                        v-else
                        class="callout-content-text prose prose-sm"
                        v-html="renderedContent || 'Double-click to edit...'"
                    ></div>
                </div>
                <Dropdown :options="dropdownOptions" placement="bottom-end">
                    <Button variant="ghost" size="sm" class="callout-menu-btn">
                        <LucideMoreHorizontal class="size-3.5" />
                    </Button>
                </Dropdown>
            </div>
        </template>

        <!-- Title Edit Dialog -->
        <Dialog v-model="showTitleDialog" :options="{ title: 'Edit Callout Title' }">
            <template #body-content>
                <div class="space-y-4">
                    <Input
                        v-model="editingTitle"
                        label="Title"
                        placeholder="Leave empty for default title"
                        @keydown.enter="saveTitle"
                    />
                    <p class="text-sm text-gray-500">
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
/* Frappe UI Alert-style callouts */
.callout-block-wrapper {
    margin: 1rem 0;
    padding: 0.875rem 1rem;
    border-radius: 0.375rem;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

/* Remove the selected outline - it's distracting when editing */
.callout-block-wrapper.is-selected {
    outline: none;
}

.callout-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.callout-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
}

.callout-icon :deep(svg) {
    width: 1rem;
    height: 1rem;
}

.callout-title-text {
    flex: 1;
    font-weight: 500;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-gray-9, #111827);
}

.callout-menu-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
    flex-shrink: 0;
}

.callout-block-wrapper:hover .callout-menu-btn {
    opacity: 1;
}

.callout-inline {
    display: flex;
    align-items: start;
    gap: 0.75rem;
}

.callout-content-inline {
    flex: 1;
    min-width: 0;
}

.callout-content {
    font-size: 0.875rem;
    line-height: 1.5;
}

.callout-content-text {
    white-space: pre-wrap;
    color: var(--ink-gray-7, #4b5563);
}

/* Mini editor */
.callout-mini-editor {
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.375rem;
    background-color: var(--surface-white, #ffffff);
}

.callout-mini-editor :deep(.ProseMirror) {
    padding: 0.5rem;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    outline: none;
    min-height: 2.5rem;
}

.callout-mini-editor :deep(.ProseMirror p) {
    margin: 0;
}

.callout-mini-editor :deep(.ProseMirror a) {
    color: var(--ink-blue-3, #2563eb);
    text-decoration: underline;
}

/* Note - Blue (info style) */
.callout-note {
    background-color: var(--surface-blue-2, #dbeafe);
}

.callout-note .callout-icon {
    color: var(--ink-blue-3, #2563eb);
}

/* Tip - Green (success style) */
.callout-tip {
    background-color: var(--surface-green-2, #dcfce7);
}

.callout-tip .callout-icon {
    color: var(--ink-green-3, #16a34a);
}

/* Caution - Amber (warning style) */
.callout-caution {
    background-color: var(--surface-amber-2, #fef3c7);
}

.callout-caution .callout-icon {
    color: var(--ink-amber-3, #d97706);
}

/* Danger - Red (error style) */
.callout-danger {
    background-color: var(--surface-red-2, #fecaca);
}

.callout-danger .callout-icon {
    color: var(--ink-red-3, #dc2626);
}
</style>
