<template>
    <div class="wiki-editor-container">
        <div v-if="editor">
            <WikiToolbar :editor="editor" @uploadImage="handleImageUpload" />
            <WikiBubbleMenu :editor="editor" />
            <EditorContent :editor="editor" />
        </div>
        <div v-else class="wiki-editor-loading">
            Loading editor...
        </div>

        <!-- Hidden file input for slash command image upload -->
        <input
            ref="slashImageInput"
            type="file"
            accept="image/*"
            class="hidden-file-input"
            @change="handleSlashImageSelect"
        />

    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, createApp, h } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { useFileUpload, toast } from 'frappe-ui';

// Import custom extensions
import { CalloutBlock } from './tiptap-extensions/callout-block.js';
import { VideoBlock } from './tiptap-extensions/video-block.js';
import { WikiLink } from './tiptap-extensions/link-extension.js';
import { WikiImage } from './tiptap-extensions/image-extension.js';
import { SlashCommands, filterCommands } from './tiptap-extensions/slash-commands.js';
import SlashCommandsList from './tiptap-extensions/SlashCommandsList.vue';
import WikiBubbleMenu from './tiptap-extensions/WikiBubbleMenu.vue';
import WikiToolbar from './tiptap-extensions/WikiToolbar.vue';
import LinkPopup from './tiptap-extensions/LinkPopup.vue';

// Import tippy for slash command popup
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

const props = defineProps({
    content: {
        type: String,
        default: '',
    },
    saving: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['save']);
const hasUnsavedChanges = ref(false);
const lastSavedContent = ref(props.content || '');

const AUTOSAVE_DELAY = 10 * 1000;
let autosaveTimer = null;

// Create lowlight instance for syntax highlighting
const lowlight = createLowlight(common);

// File upload composable from frappe-ui
const fileUploader = useFileUpload();

// Editor instance
const editor = ref(null);

// Refs for file input and link popup
const slashImageInput = ref(null);
let linkPopupInstance = null;
let linkPopupApp = null;

/**
 * Upload file to Frappe and return the file URL
 */
async function uploadFile(file) {
    try {
        const isImage = file.type.includes('image');
        const result = await fileUploader.upload(file, {
            private: false,
            optimize: isImage,
        });

        toast.success(`${isImage ? 'Image' : 'File'} uploaded successfully`);
        return result.file_url;
    } catch (error) {
        toast.error('Failed to upload file');
        throw error;
    }
}

/**
 * Handle paste events to upload images
 */
function handlePaste(_view, event) {
    const items = event.clipboardData?.items;
    if (!items) return false;

    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                uploadFile(file).then((url) => {
                    if (editor.value) {
                        editor.value.chain().focus().setImage({ src: url }).run();
                    }
                });
            }
            return true;
        }
    }
    return false;
}

/**
 * Handle drop events to upload files
 */
function handleDrop(_view, event) {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return false;

    event.preventDefault();

    for (const file of files) {
        const isImage = file.type.includes('image');
        const isVideo = file.type.includes('video');

        if (isImage || isVideo) {
            uploadFile(file).then((url) => {
                if (editor.value) {
                    if (isVideo) {
                        editor.value.chain().focus().setVideo({ src: url }).run();
                    } else {
                        editor.value.chain().focus().setImage({ src: url }).run();
                    }
                }
            });
        }
    }

    return true;
}

/**
 * Handle image upload from toolbar
 */
async function handleImageUpload(file) {
    try {
        const url = await uploadFile(file);
        if (editor.value) {
            editor.value.chain().focus().setImage({ src: url }).run();
        }
    } catch (error) {
        console.error('Failed to upload image:', error);
    }
}

/**
 * Handle image upload from slash command
 */
function handleSlashImageSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
        handleImageUpload(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
}

/**
 * Handle slash command image upload event
 */
function handleSlashImageUploadEvent() {
    slashImageInput.value?.click();
}

/**
 * Show link popup at the given position
 */
function showLinkPopup({ editor: editorInstance, href, isNew, rect }) {
    // Destroy existing popup if any
    hideLinkPopup();

    // Create container for the popup
    const container = document.createElement('div');

    // Create Vue app for LinkPopup
    linkPopupApp = createApp({
        render() {
            return h(LinkPopup, {
                href: href || '',
                isNew,
                onSave: (newHref) => {
                    editorInstance.chain().focus().setLink({ href: newHref }).run();
                    hideLinkPopup();
                },
                onRemove: () => {
                    editorInstance.chain().focus().unsetLink().run();
                    hideLinkPopup();
                },
                onCancel: () => {
                    hideLinkPopup();
                },
            });
        },
    });
    linkPopupApp.mount(container);

    // Create tippy popup
    linkPopupInstance = tippy(document.body, {
        getReferenceClientRect: () => rect,
        appendTo: () => document.body,
        content: container,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        maxWidth: 'none',
        theme: 'none',
        arrow: false,
        offset: [0, 8],
        onHide: () => {
            // Cleanup when tippy hides
            if (linkPopupApp) {
                linkPopupApp.unmount();
                linkPopupApp = null;
            }
        },
    })[0];
}

/**
 * Hide link popup
 */
function hideLinkPopup() {
    if (linkPopupInstance && !linkPopupInstance.state.isDestroyed) {
        linkPopupInstance.destroy();
    }
    linkPopupInstance = null;

    if (linkPopupApp) {
        linkPopupApp.unmount();
        linkPopupApp = null;
    }
}

/**
 * Create suggestion configuration for slash commands
 */
function createSlashCommandsSuggestion() {
    return {
        items: ({ query }) => filterCommands(query),
        render: () => {
            let component;
            let popup;
            let isDestroyed = false;

            return {
                onStart: (props) => {
                    isDestroyed = false;
                    // Create a container for the Vue component
                    const container = document.createElement('div');

                    // Create the Vue component instance
                    component = {
                        element: container,
                        props,
                        vm: null,
                        app: null,
                    };

                    // Mount the SlashCommandsList component directly
                    import('vue').then(({ createApp }) => {
                        if (isDestroyed) return;
                        const app = createApp(SlashCommandsList, {
                            items: props.items,
                            command: props.command,
                        });
                        component.app = app;
                        component.vm = app.mount(container);
                    });

                    // Create tippy popup with no default styling
                    popup = tippy('body', {
                        getReferenceClientRect: props.clientRect,
                        appendTo: () => document.body,
                        content: container,
                        showOnCreate: true,
                        interactive: true,
                        trigger: 'manual',
                        placement: 'bottom-start',
                        maxWidth: 'none',
                        theme: 'none',
                        arrow: false,
                        offset: [0, 4],
                    })[0];
                },

                onUpdate: (props) => {
                    if (isDestroyed) return;

                    // Re-render with new items
                    if (component?.app) {
                        import('vue').then(({ createApp }) => {
                            if (isDestroyed) return;
                            // Unmount old app
                            component.app.unmount();
                            const container = component.element;
                            // Create new app with updated props
                            const app = createApp(SlashCommandsList, {
                                items: props.items,
                                command: props.command,
                            });
                            component.app = app;
                            component.vm = app.mount(container);
                        });
                    }

                    if (popup) {
                        popup.setProps({
                            getReferenceClientRect: props.clientRect,
                        });
                    }
                },

                onKeyDown: (props) => {
                    if (props.event.key === 'Escape') {
                        popup?.hide();
                        return true;
                    }

                    // Let the component handle arrow keys and enter
                    if (component?.vm?.onKeyDown) {
                        return component.vm.onKeyDown(props.event);
                    }

                    return false;
                },

                onExit: () => {
                    if (isDestroyed) return;
                    isDestroyed = true;

                    // Properly unmount Vue app
                    if (component?.app) {
                        component.app.unmount();
                    }

                    // Destroy tippy only if it exists and hasn't been destroyed
                    if (popup && !popup.state.isDestroyed) {
                        popup.destroy();
                    }

                    popup = null;
                    component = null;
                },
            };
        },
    };
}

/**
 * Initialize the editor
 */
function initEditor() {
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({
                codeBlock: false, // We use CodeBlockLowlight instead
                // Disable StarterKit's link - we use our custom WikiLink
                link: false,
            }),
            // Custom link extension with Cmd+K support
            WikiLink.configure({
                openOnClick: false,
                HTMLAttributes: {
                    rel: 'noopener noreferrer',
                },
                onOpenLinkEditor: showLinkPopup,
            }),
            Markdown,
            // Custom image extension with caption support
            WikiImage.configure({
                inline: false,
                allowBase64: true,
            }),
            Table.configure({
                resizable: true,
            }),
            TableRow,
            TableCell,
            TableHeader,
            TaskList,
            TaskItem.configure({
                nested: true,
            }),
            Placeholder.configure({
                placeholder: 'Type "/" for commands, or start writing...',
            }),
            CodeBlockLowlight.configure({
                lowlight,
            }),
            // Custom extensions
            CalloutBlock,
            VideoBlock,
            // Slash commands
            SlashCommands.configure({
                suggestion: createSlashCommandsSuggestion(),
            }),
        ],
        content: props.content || '',
        contentType: 'markdown',
        editorProps: {
            handlePaste,
            handleDrop,
            attributes: {
                class: 'prose prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none prose-code:bg-transparent prose-code:p-0 prose-code:font-normal prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:border-outline-gray-2 prose-th:border-outline-gray-2 prose-td:relative prose-th:relative prose-th:bg-surface-gray-2 wiki-editor-content',
            },
        },
        onUpdate: () => {
            handleContentChange();
        },
    });
}

function handleContentChange() {
    // Clear existing timer
    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }

    // Check if content has changed
    const currentContent = editor.value?.getMarkdown();
    if (currentContent !== undefined && currentContent !== lastSavedContent.value) {
        hasUnsavedChanges.value = true;

        // Set up debounced autosave
        autosaveTimer = setTimeout(() => {
            autoSave();
        }, AUTOSAVE_DELAY);
    }
}

async function autoSave() {
    if (props.saving || !editor.value) {
        return;
    }

    // Notify components to sync their content before we read it
    document.dispatchEvent(new CustomEvent('wiki-editor-before-save'));

    const currentContent = editor.value.getMarkdown();
    if (currentContent === undefined || currentContent === lastSavedContent.value) {
        hasUnsavedChanges.value = false;
        return;
    }

    emit('save', currentContent);
    lastSavedContent.value = currentContent;
    hasUnsavedChanges.value = false;
    // Notify components that save is complete so they can restore focus
    document.dispatchEvent(new CustomEvent('wiki-editor-after-save'));
}

function saveToDB() {
    // Clear any pending autosave
    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }

    if (!editor.value) {
        toast.error('Editor is not ready');
        return;
    }

    // Notify components to sync their content before we read it
    document.dispatchEvent(new CustomEvent('wiki-editor-before-save'));

    // Get markdown from the editor
    const markdown = editor.value.getMarkdown();
    if (markdown !== undefined) {
        emit('save', markdown);
        lastSavedContent.value = markdown;
        hasUnsavedChanges.value = false;
        // Notify components that save is complete so they can restore focus
        document.dispatchEvent(new CustomEvent('wiki-editor-after-save'));
    } else {
        toast.error('Could not get content from editor');
    }
}

// Expose methods for parent component
defineExpose({
    saveToDB,
    hasUnsavedChanges,
});

// Keyboard shortcut: Cmd+S / Ctrl+S to save
onKeyStroke('s', (e) => {
    if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        saveToDB();
    }
});

onMounted(() => {
    initEditor();
    // Expose editor on window for E2E testing
    window.wikiEditor = editor.value;
    // Listen for slash command image upload events
    document.addEventListener('wiki-editor-upload-image', handleSlashImageUploadEvent);
});

onUnmounted(() => {
    // Remove event listener
    document.removeEventListener('wiki-editor-upload-image', handleSlashImageUploadEvent);
    // Hide any open link popup
    hideLinkPopup();
    // Clean up window reference
    delete window.wikiEditor;

    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }
    if (editor.value) {
        editor.value.destroy();
    }
});
</script>

<style>
/* Tippy theme override for slash commands */
.tippy-box[data-theme~='none'] {
    background: transparent;
    border: none;
    box-shadow: none;
}

.tippy-box[data-theme~='none'] > .tippy-content {
    padding: 0;
}

/* Hidden file input */
.hidden-file-input {
    display: none;
}

/* Wiki Editor Container Styles */
.wiki-editor-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    isolation: isolate; /* Create new stacking context to contain z-index */
}

.wiki-editor-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--ink-gray-5, #6b7280);
}

/* TipTap Editor Wrapper */
.wiki-tiptap-editor {
    flex: 1;
    min-height: 500px;
    background-color: var(--surface-white, #ffffff);
    position: relative;
    margin-top: 1rem;
    max-width: 100ch;
    width: 100%;
    margin-left: auto;
    margin-right: auto;
}

/* Editor Content Styles */
.wiki-editor-content {
    min-height: 480px;
    padding: 1.5rem;
    outline: none;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 1rem;
    line-height: 1.625;
    color: var(--ink-gray-9, #111827);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0 0 0.5rem 0.5rem;
}

.wiki-editor-content:focus {
    outline: none;
}

/* Code block styling - Light theme */
.wiki-editor-content pre {
    background-color: var(--surface-gray-1, #f9fafb);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    color: var(--ink-gray-9, #111827);
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    font-size: 0.875rem;
    line-height: 1.6;
    font-family: 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
    margin: 1rem 0;
    caret-color: var(--ink-gray-9, #111827);
}

.wiki-editor-content pre code {
    background: none;
    padding: 0;
    font-size: inherit;
    color: inherit;
    caret-color: var(--ink-gray-9, #111827);
}

/* Inline code styling */
.wiki-editor-content code {
    background-color: var(--surface-gray-2, #f3f4f6);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
    font-family: 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
}

/* Blockquote styling */
.wiki-editor-content blockquote {
    border-left: 3px solid var(--outline-gray-3, #d1d5db);
    padding-left: 1rem;
    margin: 1rem 0;
    color: var(--ink-gray-6, #4b5563);
    font-style: italic;
}

/* Link styling */
.wiki-editor-content a {
    color: var(--primary, #171717);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.wiki-editor-content a:hover {
    text-decoration-thickness: 2px;
}

/* Table styling */
.wiki-editor-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    table-layout: fixed;
}

.wiki-editor-content th,
.wiki-editor-content td {
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    padding: 0.5rem 0.75rem;
    text-align: left;
    position: relative;
    vertical-align: top;
    min-width: 80px;
}

.wiki-editor-content th {
    background-color: var(--surface-gray-1, #f9fafb);
    font-weight: 600;
}

/* Table cell selection */
.wiki-editor-content .selectedCell::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background: rgba(59, 130, 246, 0.15);
    pointer-events: none;
    z-index: 1;
}

/* Table column resize handle */
.wiki-editor-content .column-resize-handle {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: 0;
    width: 4px;
    background-color: #3b82f6;
    cursor: col-resize;
    z-index: 10;
}

/* Table resize cursor */
.wiki-editor-content.resize-cursor {
    cursor: col-resize;
}

/* Horizontal rule */
.wiki-editor-content hr {
    border: none;
    border-top: 1px solid var(--outline-gray-2, #e5e7eb);
    margin: 1.5rem 0;
}

/* Image styling */
.wiki-editor-content img {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
}

/* Image caption styling using img + em pattern
   Usage in markdown:
   ![alt text](image.jpg)
   *caption text*
   (no blank line between image and caption)
*/
.wiki-editor-content img:has(+ em) {
    margin-bottom: 0;
}

.wiki-editor-content img + em {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: var(--ink-gray-6, #4b5563);
    text-align: center;
}

/* Selected node */
.wiki-editor-content .ProseMirror-selectednode {
    outline: 2px solid var(--primary, #171717);
    outline-offset: 2px;
}

/* Syntax highlighting - GitHub Light inspired theme */
.wiki-editor-content .hljs-comment,
.wiki-editor-content .hljs-quote {
    color: #6a737d;
    font-style: italic;
}

.wiki-editor-content .hljs-keyword,
.wiki-editor-content .hljs-selector-tag {
    color: #d73a49;
}

.wiki-editor-content .hljs-deletion {
    color: #b31d28;
    background-color: #ffeef0;
}

.wiki-editor-content .hljs-string,
.wiki-editor-content .hljs-doctag {
    color: #032f62;
}

.wiki-editor-content .hljs-addition {
    color: #22863a;
    background-color: #f0fff4;
}

.wiki-editor-content .hljs-number,
.wiki-editor-content .hljs-literal {
    color: #005cc5;
}

.wiki-editor-content .hljs-symbol,
.wiki-editor-content .hljs-bullet {
    color: #e36209;
}

.wiki-editor-content .hljs-function {
    color: #6f42c1;
}

.wiki-editor-content .hljs-title {
    color: #6f42c1;
    font-weight: 600;
}

.wiki-editor-content .hljs-built_in {
    color: #005cc5;
}

.wiki-editor-content .hljs-class .hljs-title,
.wiki-editor-content .hljs-type {
    color: #22863a;
}

.wiki-editor-content .hljs-attr {
    color: #005cc5;
}

.wiki-editor-content .hljs-variable,
.wiki-editor-content .hljs-template-variable {
    color: #e36209;
}

.wiki-editor-content .hljs-name {
    color: #22863a;
}

.wiki-editor-content .hljs-selector-id,
.wiki-editor-content .hljs-selector-class {
    color: #6f42c1;
}

.wiki-editor-content .hljs-regexp {
    color: #032f62;
}

.wiki-editor-content .hljs-link {
    color: #005cc5;
    text-decoration: underline;
}

.wiki-editor-content .hljs-meta {
    color: #6a737d;
}

.wiki-editor-content .hljs-operator {
    color: #d73a49;
}

.wiki-editor-content .hljs-punctuation {
    color: #24292e;
}

.wiki-editor-content .hljs-emphasis {
    font-style: italic;
}

.wiki-editor-content .hljs-strong {
    font-weight: bold;
}

.wiki-editor-content .hljs-params {
    color: #24292e;
}

.wiki-editor-content .hljs-property {
    color: #005cc5;
}
</style>
