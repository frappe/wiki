<script setup>
/**
 * CalloutBlockView Component
 *
 * Renders a callout/aside block in the TipTap editor.
 * Supports types: note, tip, caution, danger
 * Uses a minimal TipTap sub-editor for rich text editing (bold, italic, links).
 */

import { computed, ref, nextTick, onMounted, onUnmounted, shallowRef } from 'vue';
import { NodeViewWrapper, EditorContent, Editor } from '@tiptap/vue-3';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Markdown } from '@tiptap/markdown';
import { Dropdown, Button, Dialog, Input, TextInput } from 'frappe-ui';
import LucideMoreHorizontal from '~icons/lucide/more-horizontal';
import LucideInfo from '~icons/lucide/info';
import LucideLightbulb from '~icons/lucide/lightbulb';
import LucideTriangleAlert from '~icons/lucide/triangle-alert';
import LucideShieldAlert from '~icons/lucide/shield-alert';
import LucidePencil from '~icons/lucide/pencil';
import LucideCheck from '~icons/lucide/check';
import LucideX from '~icons/lucide/x';
import LucideLink from '~icons/lucide/link';

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
const subEditor = shallowRef(null);
let isSaving = false;

const wrapperRef = ref(null);

// Link input state
const showLinkInput = ref(false);
const linkUrl = ref('');
const linkInputRef = ref(null);

// Render inline markdown to HTML for view mode preview
function renderInlineMarkdown(text) {
    if (!text) return '';
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Bold: **text**
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic: *text* (but not inside bold markers)
        .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
        // Links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        // Line breaks
        .replace(/\n/g, '<br>');
    return html;
}

const renderedContent = computed(() => renderInlineMarkdown(props.node.attrs.content));

function startEditing() {
    isEditingContent.value = true;
    nextTick(() => {
        subEditor.value = new Editor({
            extensions: [
                StarterKit.configure({
                    blockquote: false,
                    bulletList: false,
                    codeBlock: false,
                    heading: false,
                    horizontalRule: false,
                    listItem: false,
                    orderedList: false,
                    link: false,
                }),
                Link.configure({
                    openOnClick: false,
                    HTMLAttributes: {
                        rel: 'noopener noreferrer',
                    },
                }),
                Markdown,
            ],
            content: props.node.attrs.content || '',
            contentType: 'markdown',
            editorProps: {
                attributes: {
                    class: 'callout-sub-editor-content',
                },
                handleKeyDown(_view, event) {
                    if (event.key === 'Escape') {
                        finishEditing();
                        return true;
                    }
                    return false;
                },
            },
        });

        nextTick(() => {
            subEditor.value?.commands.focus('end');
        });
    });
}

function syncSubEditorContent() {
    if (!subEditor.value) return;
    props.updateAttributes({ content: subEditor.value.getMarkdown() });
}

function finishEditing() {
    if (isSaving) return;
    syncSubEditorContent();
    subEditor.value?.destroy();
    subEditor.value = null;
    isEditingContent.value = false;
    showLinkInput.value = false;
}

function handleBeforeSave() {
    if (isEditingContent.value && subEditor.value) {
        isSaving = true;
        syncSubEditorContent();
    }
}

function handleAfterSave() {
    if (isSaving) {
        isSaving = false;
        nextTick(() => {
            subEditor.value?.commands.focus();
        });
    }
}

function handleClickOutside(event) {
    if (!isEditingContent.value || !wrapperRef.value) return;
    const el = wrapperRef.value.$el || wrapperRef.value;
    if (!el.contains(event.target)) {
        finishEditing();
    }
}

onMounted(() => {
    document.addEventListener('wiki-editor-before-save', handleBeforeSave);
    document.addEventListener('wiki-editor-after-save', handleAfterSave);
    document.addEventListener('mousedown', handleClickOutside, true);

    if (!props.node.attrs.content) {
        startEditing();
    }
});

onUnmounted(() => {
    document.removeEventListener('wiki-editor-before-save', handleBeforeSave);
    document.removeEventListener('wiki-editor-after-save', handleAfterSave);
    document.removeEventListener('mousedown', handleClickOutside, true);

    if (subEditor.value) {
        subEditor.value.destroy();
        subEditor.value = null;
    }
});

// Toolbar actions
function toggleBold() {
    subEditor.value?.chain().focus().toggleBold().run();
}

function toggleItalic() {
    subEditor.value?.chain().focus().toggleItalic().run();
}

function openLinkInput() {
    if (!subEditor.value) return;
    const attrs = subEditor.value.getAttributes('link');
    linkUrl.value = attrs.href || '';
    showLinkInput.value = true;

    nextTick(() => {
        if (linkInputRef.value?.el) {
            linkInputRef.value.el.focus();
            linkInputRef.value.el.select();
        }
    });
}

function confirmLink() {
    if (!subEditor.value) return;
    let url = linkUrl.value.trim();

    if (!url) {
        subEditor.value.chain().focus().unsetLink().run();
    } else {
        if (!url.startsWith('/') && !url.startsWith('#') && !url.match(/^[a-zA-Z]+:\/\//)) {
            url = 'https://' + url;
        }
        subEditor.value.chain().focus().setLink({ href: url }).run();
    }

    showLinkInput.value = false;
    linkUrl.value = '';
}

function cancelLink() {
    showLinkInput.value = false;
    linkUrl.value = '';
    subEditor.value?.commands.focus();
}

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
        icon: LucidePencil,
        onClick: openTitleDialog,
    },
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
        ref="wrapperRef"
        class="callout-block-wrapper my-4 px-4 py-3.5 rounded-md relative flex flex-col gap-2"
        :class="[`callout-${normalizedType}`, { 'outline-none': selected }]"
        contenteditable="false"
    >
        <div class="flex items-center gap-2">
            <span class="shrink-0 flex items-center callout-icon" v-html="icon"></span>
            <span class="flex-1 font-medium text-sm leading-[1.4] text-ink-gray-9">{{ displayTitle }}</span>
            <Dropdown :options="dropdownOptions" placement="bottom-end">
                <Button variant="ghost" size="sm" class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 callout-menu-btn">
                    <LucideMoreHorizontal class="size-3.5" />
                </Button>
            </Dropdown>
        </div>
        <div class="text-sm leading-normal" @dblclick="!isEditingContent && startEditing()">
            <template v-if="isEditingContent && subEditor">
                <!-- Inline toolbar -->
                <div class="flex items-center gap-0.5 mb-1.5">
                    <button
                        @mousedown.prevent="toggleBold"
                        class="toolbar-btn text-[0.8125rem]"
                        :class="{ '!bg-surface-gray-3 !text-ink-gray-9': subEditor.isActive('bold') }"
                        title="Bold (Ctrl+B)"
                    >
                        <strong>B</strong>
                    </button>
                    <button
                        @mousedown.prevent="toggleItalic"
                        class="toolbar-btn text-[0.8125rem]"
                        :class="{ '!bg-surface-gray-3 !text-ink-gray-9': subEditor.isActive('italic') }"
                        title="Italic (Ctrl+I)"
                    >
                        <em>I</em>
                    </button>
                    <button
                        @mousedown.prevent="openLinkInput"
                        class="toolbar-btn"
                        :class="{ '!bg-surface-gray-3 !text-ink-gray-9': subEditor.isActive('link') }"
                        title="Link"
                    >
                        <LucideLink class="size-3.5" />
                    </button>
                </div>

                <!-- Link URL input row -->
                <div v-if="showLinkInput" class="flex items-center gap-1 mb-1.5">
                    <TextInput
                        ref="linkInputRef"
                        type="text"
                        class="flex-1"
                        size="sm"
                        placeholder="https://example.com"
                        v-model="linkUrl"
                        @keydown.enter="confirmLink"
                        @keydown.escape.stop="cancelLink"
                    />
                    <button @mousedown.prevent="confirmLink" class="toolbar-btn" title="Apply">
                        <LucideCheck class="size-3.5" />
                    </button>
                    <button @mousedown.prevent="cancelLink" class="toolbar-btn" title="Cancel">
                        <LucideX class="size-3.5" />
                    </button>
                </div>

                <!-- Sub-editor -->
                <EditorContent :editor="subEditor" />
            </template>
            <div v-else class="callout-content-text text-ink-gray-7">
                <span v-if="node.attrs.content" v-html="renderedContent"></span>
                <span v-else class="text-gray-400">Double-click to edit...</span>
            </div>
        </div>

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
/* Toolbar button base style */
.toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--ink-gray-6);
    transition: all 0.15s ease;
}

.toolbar-btn:hover {
    background-color: var(--surface-gray-2);
    color: var(--ink-gray-9);
}

/* Icon sizing */
.callout-icon :deep(svg) {
    width: 1rem;
    height: 1rem;
}

/* Menu button visibility on hover */
.callout-block-wrapper:hover .callout-menu-btn {
    opacity: 1;
}

/* Sub-editor ProseMirror element styling */
.callout-block-wrapper :deep(.callout-sub-editor-content) {
    outline: none;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.375rem;
    background-color: var(--surface-white, #ffffff);
    min-height: 2.5rem;
    color: var(--ink-gray-7, #4b5563);
}

.callout-block-wrapper :deep(.callout-sub-editor-content:focus) {
    border-color: var(--outline-gray-4, #9ca3af);
    box-shadow: 0 0 0 2px rgba(156, 163, 175, 0.25);
}

.callout-block-wrapper :deep(.callout-sub-editor-content p) {
    margin: 0;
}

.callout-block-wrapper :deep(.callout-sub-editor-content a) {
    color: var(--ink-blue-3, #2563eb);
    text-decoration: underline;
}

/* Callout type colors - these use CSS variables that don't map to Tailwind */
.callout-note {
    background-color: var(--surface-blue-2, #dbeafe);
}
.callout-note .callout-icon {
    color: var(--ink-blue-3, #2563eb);
}

.callout-tip {
    background-color: var(--surface-green-2, #dcfce7);
}
.callout-tip .callout-icon {
    color: var(--ink-green-3, #16a34a);
}

.callout-caution {
    background-color: var(--surface-amber-2, #fef3c7);
}
.callout-caution .callout-icon {
    color: var(--ink-amber-3, #d97706);
}

.callout-danger {
    background-color: var(--surface-red-2, #fecaca);
}
.callout-danger .callout-icon {
    color: var(--ink-red-3, #dc2626);
}
</style>
