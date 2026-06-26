<template>
    <div class="wiki-editor-container">
        <div v-if="editor">
            <template v-if="!readonly">
                <WikiToolbar :editor="editor" @uploadImage="handleImageUpload" />
                <WikiBubbleMenu :editor="editor" />
            </template>
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
import { Extension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import {
	Table,
	TableCell,
	TableHeader,
	TableRow,
} from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { StarterKit } from '@tiptap/starter-kit';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { onKeyStroke } from '@vueuse/core';
import { toast, useFileUpload } from 'frappe-ui';
import { common, createLowlight } from 'lowlight';
import { createApp, h, onMounted, onUnmounted, ref, watch } from 'vue';
import { WikiCodeBlock } from './tiptap-extensions/code-block-extension.js';

import LinkPopup from './tiptap-extensions/LinkPopup.vue';
import SlashCommandsList from './tiptap-extensions/SlashCommandsList.vue';
import WikiBubbleMenu from './tiptap-extensions/WikiBubbleMenu.vue';
import WikiToolbar from './tiptap-extensions/WikiToolbar.vue';
// Import custom extensions
import { CalloutBlock } from './tiptap-extensions/callout-block.js';
import { IframeBlock } from './tiptap-extensions/iframe-block.js';
import { WikiImage } from './tiptap-extensions/image-extension.js';
import { WikiLink } from './tiptap-extensions/link-extension.js';
import { MermaidBlock } from './tiptap-extensions/mermaid-block.js';
import { PdfBlock } from './tiptap-extensions/pdf-block.js';
import {
	SlashCommands,
	filterCommands,
} from './tiptap-extensions/slash-commands.js';
import { VideoBlock } from './tiptap-extensions/video-block.js';

// Import tippy for slash command popup
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

// Preserve consecutive blank lines in markdown round-trips.
// Parse: marked's 'space' tokens (ignored by default) become empty paragraphs.
const PreserveBlankLines = Extension.create({
	name: 'preserveBlankLines',
	markdownTokenName: 'space',
	parseMarkdown(token) {
		const count = Math.floor(token.raw.length / 2) - 1;
		if (count <= 0) return null;
		return Array.from({ length: count }, () => ({ type: 'paragraph' }));
	},
});

// Serialize: empty paragraphs render as blank lines instead of &nbsp;.
const WikiParagraph = Paragraph.extend({
	renderMarkdown: (node, h) => {
		if (!node) return '';
		const content = Array.isArray(node.content) ? node.content : [];
		if (content.length === 0) return '';
		return h.renderChildren(content);
	},
});

const props = defineProps({
	content: {
		type: String,
		default: '',
	},
	documentKey: {
		type: String,
		default: null,
	},
	// The canonical content the parent has confirmed as saved. The editor
	// normalizes this with its configured Markdown manager before handing
	// both snapshots to the store for comparison.
	savedContent: {
		type: String,
		default: '',
	},
	// Render the document for reading only: no toolbar/bubble menu, the
	// ProseMirror view is non-editable, and every save path short-circuits.
	// Used for git-synced spaces whose content is owned by the repo.
	readonly: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['save', 'content-change', 'content-ready']);

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
			// Hit our handler directly (not via upload_file's `method` delegation,
			// which would recurse). It converts PNG/JPEG to WebP when the Wiki
			// Setting is enabled, returning the optimized file_url.
			upload_endpoint: '/api/method/wiki.api.upload_wiki_asset',
		});

		toast.success(`${isImage ? 'Image' : 'File'} uploaded successfully`);
		return result.file_url;
	} catch (error) {
		toast.error('Failed to upload file');
		throw error;
	}
}

/**
 * Read a file into a base64 data URL for an instant local preview.
 */
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * Patch the attributes of the in-flight image node identified by uploadId.
 */
function updateImageNode(uploadId, attrs) {
	const ed = editor.value;
	if (!ed) return;
	const { state, view } = ed;
	let target = null;
	state.doc.descendants((node, pos) => {
		if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
			target = { node, pos };
			return false;
		}
	});
	if (!target) return;
	const tr = state.tr.setNodeMarkup(target.pos, undefined, {
		...target.node.attrs,
		...attrs,
	});
	view.dispatch(tr);
}

/**
 * Insert an image immediately with a local preview + loading overlay, upload
 * it in the background, then swap in the final URL (or surface an error).
 */
async function insertAndUploadImage(file) {
	const ed = editor.value;
	if (!ed) return;

	const uploadId = `upload-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 9)}`;

	let preview = '';
	try {
		preview = await fileToBase64(file);
	} catch {
		preview = '';
	}

	ed.chain()
		.focus()
		.setImage({ src: preview, uploadId, loading: true })
		.run();

	try {
		const url = await uploadFile(file);
		updateImageNode(uploadId, { src: url, loading: false, error: null });
	} catch (error) {
		updateImageNode(uploadId, {
			loading: false,
			error: error?.message || 'Failed to upload image',
		});
	}
}

/**
 * Patch the attributes of the in-flight PDF node identified by uploadId.
 */
function updatePdfNode(uploadId, attrs) {
	const ed = editor.value;
	if (!ed) return;
	const { state, view } = ed;
	let target = null;
	state.doc.descendants((node, pos) => {
		if (node.type.name === 'pdfBlock' && node.attrs.uploadId === uploadId) {
			target = { node, pos };
			return false;
		}
	});
	if (!target) return;
	const tr = state.tr.setNodeMarkup(target.pos, undefined, {
		...target.node.attrs,
		...attrs,
	});
	view.dispatch(tr);
}

/**
 * Insert a PDF card immediately with a loading state, upload it in the
 * background, then swap in the final URL (or surface an error).
 */
async function insertAndUploadPdf(file) {
	const ed = editor.value;
	if (!ed) return;

	const uploadId = `upload-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 9)}`;

	ed.chain()
		.focus()
		.setPdf({ filename: file.name, uploadId, loading: true })
		.run();

	try {
		const url = await uploadFile(file);
		updatePdfNode(uploadId, { src: url, loading: false, error: null });
	} catch (error) {
		updatePdfNode(uploadId, {
			loading: false,
			error: error?.message || 'Failed to upload PDF',
		});
	}
}

/**
 * Handle paste events to upload images and parse markdown text
 */
function handlePaste(_view, event) {
	const items = event.clipboardData?.items;
	if (!items) return false;

	for (const item of items) {
		if (item.type.indexOf('image') === 0) {
			event.preventDefault();
			const file = item.getAsFile();
			if (file) {
				insertAndUploadImage(file);
			}
			return true;
		}
	}

	// If clipboard has plain text but no HTML, treat it as markdown so
	// pastes like `# Heading` or `**bold**` render instead of staying literal.
	// When HTML is present (Word, Google Docs, web pages), let ProseMirror's
	// default handler keep the rich formatting.
	const text = event.clipboardData?.getData('text/plain');
	const html = event.clipboardData?.getData('text/html');
	if (text && !html && editor.value?.markdown) {
		event.preventDefault();
		editor.value
			.chain()
			.focus()
			.insertContent(text, { contentType: 'markdown' })
			.run();
		return true;
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
		const isPdf =
			file.type === 'application/pdf' ||
			file.name?.toLowerCase().endsWith('.pdf');

		if (isImage) {
			insertAndUploadImage(file);
		} else if (isVideo && editor.value) {
			editor.value.commands.uploadVideo(file);
		} else if (isPdf) {
			insertAndUploadPdf(file);
		}
	}

	return true;
}

/**
 * Handle PDF upload events from the toolbar / slash command (which open a file
 * picker and dispatch the chosen file through this custom event).
 */
function handlePdfUploadEvent(event) {
	const file = event.detail?.file;
	if (file) {
		insertAndUploadPdf(file);
	}
}

/**
 * Handle image upload from toolbar
 */
async function handleImageUpload(file) {
	await insertAndUploadImage(file);
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
						// Flip above the caret when there's no room below (e.g. the
						// on-screen keyboard covers the lower viewport on mobile), and
						// keep the menu within the viewport. Mirrors the bubble menu.
						popperOptions: {
							modifiers: [
								{
									name: 'flip',
									options: {
										fallbackPlacements: ['top-start', 'bottom-start'],
									},
								},
								{
									name: 'preventOverflow',
									options: { boundary: 'viewport', padding: 8 },
								},
							],
						},
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
				link: false, // We use our custom WikiLink
				paragraph: false, // We use WikiParagraph for blank line support
			}),
			WikiParagraph,
			// Custom link extension with Cmd+K support
			WikiLink.configure({
				openOnClick: false,
				HTMLAttributes: {
					rel: 'noopener noreferrer',
				},
				onOpenLinkEditor: showLinkPopup,
			}),
			Markdown.configure({
				markedOptions: {
					breaks: true,
				},
			}),
			PreserveBlankLines,
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
			WikiCodeBlock.configure({
				lowlight,
			}),
			// Custom extensions
			CalloutBlock,
			IframeBlock,
			MermaidBlock,
			PdfBlock,
			VideoBlock.configure({
				uploadFunction: uploadFile,
			}),
			// Slash commands
			SlashCommands.configure({
				suggestion: createSlashCommandsSuggestion(),
			}),
		],
		content: props.content || '',
		contentType: 'markdown',
		editable: !props.readonly,
		editorProps: {
			handlePaste,
			handleDrop,
			attributes: {
				class:
					'prose prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none prose-code:bg-transparent prose-code:p-0 prose-code:font-normal prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:border-outline-gray-2 prose-th:border-outline-gray-2 prose-td:relative prose-th:relative prose-th:bg-surface-gray-2 prose-a:underline prose-a:[text-underline-offset:2px] prose-a:[word-break:break-all] hover:prose-a:text-ink-gray-7 wiki-editor-content' +
					(props.readonly ? '' : ' is-editable'),
			},
		},
		onUpdate: () => {
			handleContentChange();
		},
	});

	emitContentReady();
}

function normalizeMarkdown(content) {
	const markdown = content ?? '';
	const manager = editor.value?.markdown;
	if (!manager) return markdown;
	try {
		return manager.serialize(manager.parse(markdown));
	} catch (error) {
		console.warn('[WikiEditor] Could not normalize markdown', error);
		return markdown;
	}
}

function getMarkdown() {
	const markdown = editor.value?.getMarkdown();
	return markdown === undefined ? undefined : normalizeMarkdown(markdown);
}

function emitContentChange(options = {}) {
	const content = getMarkdown();
	if (content === undefined) return;
	emit('content-change', content, props.documentKey, options);
}

// The store compares editor-normalized snapshots. This keeps parser
// round-trip differences from becoming phantom unsaved changes.
function emitContentReady() {
	const currentContent = getMarkdown();
	if (currentContent === undefined) return;
	emit(
		'content-ready',
		currentContent,
		normalizeMarkdown(props.savedContent),
		props.documentKey,
	);
}

function handleContentChange() {
	if (autosaveTimer) {
		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}

	const currentContent = getMarkdown();
	if (currentContent === undefined) return;
	emitContentChange();

	if (currentContent === normalizeMarkdown(props.savedContent)) return;

	autosaveTimer = setTimeout(() => {
		autosaveTimer = null;
		autoSave();
	}, AUTOSAVE_DELAY);
}

async function autoSave() {
	if (!editor.value) return;

	// Notify components to sync their content before we read it
	document.dispatchEvent(new CustomEvent('wiki-editor-before-save'));

	const currentContent = getMarkdown();
	if (currentContent === undefined) return;
	emitContentChange();
	if (currentContent === normalizeMarkdown(props.savedContent)) return;

	emit('save', currentContent);
	document.dispatchEvent(new CustomEvent('wiki-editor-after-save'));
}

function saveToDB() {
	// Read-only documents (git-synced spaces) never write back.
	if (props.readonly) return;
	// Clear any pending autosave
	if (autosaveTimer) {
		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}

	if (!editor.value) {
		toast.error('Editor is not ready');
		return;
	}

	// Notify components to sync their content before we read it
	document.dispatchEvent(new CustomEvent('wiki-editor-before-save'));

	// Get markdown from the editor
	const markdown = getMarkdown();
	if (markdown !== undefined) {
		emitContentChange();
		if (markdown !== normalizeMarkdown(props.savedContent)) {
			emit('save', markdown);
		}
		document.dispatchEvent(new CustomEvent('wiki-editor-after-save'));
	} else {
		toast.error('Could not get content from editor');
	}
}

watch(
	() => props.savedContent,
	() => emitContentReady(),
);

// Expose methods for parent component
defineExpose({
	saveToDB,
	getMarkdown,
});

// Keyboard shortcut: Cmd+S / Ctrl+S to save
onKeyStroke('s', (e) => {
	if (props.readonly) return;
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
	document.addEventListener(
		'wiki-editor-upload-image',
		handleSlashImageUploadEvent,
	);
	// Listen for PDF upload events (toolbar + slash command)
	document.addEventListener('wiki-editor-upload-pdf', handlePdfUploadEvent);
});

onUnmounted(() => {
	// Remove event listener
	document.removeEventListener(
		'wiki-editor-upload-image',
		handleSlashImageUploadEvent,
	);
	document.removeEventListener('wiki-editor-upload-pdf', handlePdfUploadEvent);
	// Hide any open link popup
	hideLinkPopup();
	// Clean up window reference
	delete window.wikiEditor;

	if (autosaveTimer) {
		clearTimeout(autosaveTimer);
	}
	emitContentChange({ persistImmediately: true });
	if (editor.value) {
		editor.value.destroy();
	}
});
</script>

