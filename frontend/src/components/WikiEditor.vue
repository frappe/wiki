<template>
    <div class="wiki-editor-container" ref="containerRef">
        <div>
            <!-- Stays outside the content row: it's a full-width sticky bar, and
                 making it a flex child would strand it above one column. -->
            <WikiToolbar v-if="!readonly" :editor="editor" @uploadImage="handleImageUpload" />
            <EditorTableOfContents v-if="showTocStrip" :editor="editor" variant="strip" />
            <!-- The outline gets a gutter of its own rather than floating over
                 a centred column's leftovers: the padding reserves it, and the
                 column re-centres in what remains. The column shifts when the
                 outline appears, which is what buys it back on a 1280px
                 screen — floating over both gutters needed 1400. -->
            <div class="relative" :class="showTocRail ? 'pr-60' : ''">
                <div class="mx-auto w-full max-w-3xl px-8">
                    <slot name="title" />
                    <EditorContent :editor="editor" :class="contentClass" />
                </div>
                <EditorTableOfContents v-if="showTocRail" :editor="editor" variant="rail" />
            </div>
            <!-- After EditorContent so the ProseMirror DOM is attached when the
                 bubble menu mounts; it derives its flip boundary from the editor's
                 scroll ancestor, which must be reachable at that point. -->
            <WikiBubbleMenu v-if="!readonly" :editor="editor" />
            <!-- Floating row/column/cell controls shown while the selection is
                 inside a table; replaces the old WikiTableDropdown actions. -->
            <EditorTableMenu v-if="!readonly" :editor="editor" />
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
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import {
	Table,
	TableCell,
	TableHeader,
	TableRow,
} from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { onKeyStroke, useElementSize } from '@vueuse/core';
import { toast, useFileUpload } from 'frappe-ui';
import {
	computed,
	createApp,
	h,
	inject,
	onBeforeUnmount,
	onMounted,
	onUnmounted,
	ref,
	shallowRef,
	watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
	createTrailingScheduler,
	memoizeLast,
	onEditorFlushRequest,
} from '@/lib/editorContentSync';
import { SPACE_TREE_KEY, crumbRoute, trailToNode } from '@/lib/spaceTree';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useSpaceStore } from '@/stores/space';
import {
	CodeBlock,
	EditorContent,
	EditorTableMenu,
	Emoji,
	useEditor,
} from 'frappe-ui/editor';
import EditorTableOfContents from './EditorTableOfContents.vue';
import LinkPopup from './tiptap-extensions/LinkPopup.vue';
import PageLinkList from './tiptap-extensions/PageLinkList.vue';
import SlashCommandsList from './tiptap-extensions/SlashCommandsList.vue';
import WikiBubbleMenu from './tiptap-extensions/WikiBubbleMenu.vue';
import WikiToolbar from './tiptap-extensions/WikiToolbar.vue';
// Import custom extensions
import { CalloutBlock } from './tiptap-extensions/callout-block.js';
import { IframeBlock } from './tiptap-extensions/iframe-block.js';
import { isEmbedUrlPaste } from './tiptap-extensions/iframe-embed.js';
import { WikiImage } from './tiptap-extensions/image-extension.js';
import { WikiLink } from './tiptap-extensions/link-extension.js';
import { canonicalizeMarkdown } from './tiptap-extensions/markdown-normalize.js';
import { MermaidBlock } from './tiptap-extensions/mermaid-block.js';
import {
	PageLinks,
	docKeyFromHref,
	findPageByTitle,
	pickerItems,
	linkablePages,
} from './tiptap-extensions/page-links.js';
import {
	dataUrlToFile,
	tagDataImagesInJSON,
	tagDataImagesInSlice,
} from './tiptap-extensions/paste-data-images.js';
import { PdfBlock } from './tiptap-extensions/pdf-block.js';
import { PreserveBlankLines } from './tiptap-extensions/preserve-blank-lines.js';
import {
	SLASH_COMMANDS,
	SlashCommands,
	filterCommands,
} from './tiptap-extensions/slash-commands.js';
import { VideoBlock } from './tiptap-extensions/video-block.js';
import { WikiUnderline } from './tiptap-extensions/underline-extension.js';
import { wikiMarkdown } from './tiptap-extensions/wiki-markdown.js';
import { wikiStarterKit } from './tiptap-extensions/wiki-starterkit.js';

// Import tippy for slash command popup
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

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
	// The outline stands down when something wider has claimed the right of
	// the page — the page settings panel. Two lists of the page at once is one
	// too many.
	showOutline: {
		type: Boolean,
		default: true,
	},
});

const emit = defineEmits([
	'save',
	'save-all',
	'content-change',
	'content-ready',
]);

const spaceTree = inject(SPACE_TREE_KEY, null);
const spaceStore = useSpaceStore();
const draftStore = useDraftWorkspaceStore();

function spacePages() {
	return linkablePages(spaceTree?.value?.children);
}

// A page created from the link picker goes in the open page's folder.
async function createPageBesideThis(title) {
	const trail = trailToNode(
		spaceTree?.value?.children,
		(node) => node.doc_key === props.documentKey,
	);
	const parentKey = trail?.at(-2)?.doc_key ?? null;
	try {
		const docKey = await draftStore.createNode({ parentKey, title }).promise;
		toast.success(`Added “${title}” as a draft page in this change request`);
		return docKey;
	} catch {
		toast.error(`Could not create “${title}”`);
		return null;
	}
}
const route = useRoute();
const router = useRouter();

// The page a `wiki:` link points at, with its editor URL. Null for any other
// link, or when the page is no longer in this space.
function linkedPage(href) {
	const docKey = docKeyFromHref(href);
	if (!docKey) return null;
	const node = trailToNode(
		spaceTree?.value?.children,
		(candidate) => candidate.doc_key === docKey,
	)?.at(-1);
	const target = node && crumbRoute(node, route.params.spaceId);
	return target ? { title: node.title, href: router.resolve(target).href } : null;
}

const AUTOSAVE_DELAY = 10 * 1000;
let autosaveTimer = null;

// Reading the page as markdown serializes and re-parses the whole document.
// Doing it on every keystroke made typing lag by seconds on large pages, so
// edits are reported once typing pauses, and on blur, save and unmount.
const contentSync = createTrailingScheduler({
	delay: 300,
	maxWait: 2000,
	run: reportContentChange,
});
const stopFlushRequests = onEditorFlushRequest(() => contentSync.flush());

// File upload composable from frappe-ui
const fileUploader = useFileUpload();

// Refs for file input and link popup
const containerRef = ref(null);
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
	startUpload(uploadId);

	let preview = '';
	try {
		preview = await fileToBase64(file);
	} catch {
		preview = '';
	}

	ed.chain().focus().setImage({ src: preview, uploadId, loading: true }).run();

	await uploadIntoNode(
		uploadId,
		() => uploadFile(file),
		updateImageNode,
		'Failed to upload image',
	);
}

// The saved content holds an upload only once its node has the file URL.
// Until then the upload blocks submit and merge, from the moment it starts.
const editorUploadIds = new Set();

function startUpload(uploadId) {
	editorUploadIds.add(uploadId);
	draftStore.setUploadState(uploadId, 'uploading');
}

async function uploadIntoNode(uploadId, upload, updateNode, errorMessage) {
	try {
		const url = await upload();
		if (!editor.value) return;
		updateNode(uploadId, { src: url, loading: false, error: null });
		editorUploadIds.delete(uploadId);
		draftStore.clearUploads([uploadId]);
	} catch (error) {
		if (!editor.value) return;
		updateNode(uploadId, {
			loading: false,
			error: error?.message || errorMessage,
		});
		draftStore.setUploadState(uploadId, 'failed');
		forgetRemovedUploads();
	}
}

// A failed upload stops blocking once its node is removed from the page.
function forgetRemovedUploads() {
	const failed = [...editorUploadIds].filter(
		(uploadId) => draftStore.uploads.get(uploadId) === 'failed',
	);
	if (!failed.length || !editor.value) return;
	const onPage = new Set();
	editor.value.state.doc.descendants((node) => {
		if (node.attrs.uploadId) onPage.add(node.attrs.uploadId);
	});
	const removed = failed.filter((uploadId) => !onPage.has(uploadId));
	for (const uploadId of removed) editorUploadIds.delete(uploadId);
	draftStore.clearUploads(removed);
}

/**
 * Upload base64 images that arrived through a paste and swap in their file
 * URLs. Until then the nodes are `loading`, so the base64 never serializes.
 */
function uploadPastedDataImages(uploads) {
	for (const { uploadId, src } of uploads) {
		startUpload(uploadId);
		uploadIntoNode(
			uploadId,
			() => dataUrlToFile(src).then(uploadFile),
			updateImageNode,
			'Failed to upload image',
		);
	}
}

// HTML from Google Docs, Notion or web pages can carry `<img src="data:…">`
// with no file on the clipboard, so handlePaste's file branch never sees it.
function transformPasted(slice) {
	const tagged = tagDataImagesInSlice(slice);
	// The tagged slice is inserted right after this returns; upload once the
	// nodes are in the doc so updateImageNode can find them.
	if (tagged.uploads.length) {
		queueMicrotask(() => uploadPastedDataImages(tagged.uploads));
	}
	return tagged.slice;
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

	startUpload(uploadId);
	ed.chain()
		.focus()
		.setPdf({ filename: file.name, uploadId, loading: true })
		.run();

	await uploadIntoNode(
		uploadId,
		() => uploadFile(file),
		updatePdfNode,
		'Failed to upload PDF',
	);
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

	// A paste that is nothing but an embeddable URL belongs to the iframe
	// block's paste rule. Handling it as markdown here would consume the event
	// (returning true stops ProseMirror applying its slice, and with it every
	// paste rule) and leave a bare link where the video should be.
	if (text && isEmbedUrlPaste(text)) {
		return false;
	}

	if (text && !html && editor.value?.markdown) {
		event.preventDefault();
		const { json, uploads } = tagDataImagesInJSON(
			editor.value.markdown.parse(text),
		);
		editor.value.chain().focus().insertContent(json).run();
		uploadPastedDataImages(uploads);
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
				page: linkedPage(href),
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
 * A suggestion config whose menu is the `menu` component in a tippy popup. Shared by
 * the "/" commands and the "[[" page links; `menuProps` adds each menu's own
 * props from the suggestion's.
 */
function createSuggestionMenu(suggestion, menu, menuProps = () => ({})) {
	return {
		...suggestion,
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

					// Mount synchronously: onUpdate fires right after onStart with the
					// fetched items, and it skips re-rendering while `component.app` is
					// null — an async mount here would swallow that first update.
					const app = createApp(menu, {
						items: props.items,
						command: props.command,
						...menuProps(props),
					});
					component.app = app;
					component.vm = app.mount(container);

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
						component.app.unmount();
						const app = createApp(menu, {
							items: props.items,
							command: props.command,
							...menuProps(props),
						});
						component.app = app;
						component.vm = app.mount(component.element);
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

// Final flush of unsaved work. Registered before useEditor() on purpose:
// both hook onBeforeUnmount, they run in registration order, and useEditor's
// hook destroys the editor — this one must read it while it's still alive.
onBeforeUnmount(() => {
	stopFlushRequests();
	contentSync.cancel();
	if (autosaveTimer) {
		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}
	emitContentChange({ persistImmediately: true });
});

// Seeds the editor and receives serialized markdown on every update; the
// save flow reads normalized markdown from the editor directly instead.
const editorContent = shallowRef(props.content || '');

const editor = useEditor({
	content: editorContent,
	format: 'markdown',
	editable: () => !props.readonly,
	extensions: [
		wikiStarterKit({ paragraph: false }),
		WikiUnderline,
		WikiParagraph,
		// Custom link extension with Cmd+K support
		WikiLink.configure({
			openOnClick: false,
			HTMLAttributes: {
				rel: 'noopener noreferrer',
			},
			onOpenLinkEditor: showLinkPopup,
			resolveHref: (href) => linkedPage(href)?.href ?? href,
		}),
		wikiMarkdown(),
		PreserveBlankLines,
		// Custom image extension with caption support
		WikiImage.configure({
			inline: false,
			allowBase64: true,
		}),
		Table.configure({
			resizable: true,
			renderWrapper: true,
		}),
		TableRow,
		TableCell,
		TableHeader,
		TaskList,
		TaskItem.configure({
			nested: true,
		}),
		Placeholder.configure({
			// A freshly inserted callout starts with an empty paragraph, and the
			// top-level hint reads as if the document itself were empty there.
			placeholder: ({ editor, pos }) =>
				editor.state.doc.resolve(pos).parent.type.name === 'calloutBlock'
					? 'Write the callout…'
					: 'Type "/" for commands, or start writing...',
		}),
		CodeBlock,
		// Custom extensions
		CalloutBlock,
		IframeBlock,
		MermaidBlock,
		PdfBlock,
		VideoBlock.configure({
			uploadFunction: uploadFile,
		}),
		Emoji,
		// Slash commands
		SlashCommands.configure({
			suggestion: createSuggestionMenu(
				{
					items: ({ query }) => filterCommands(query),
					// The menu opens with these before the first query runs, so a bare
					// "/" shows every command instead of "No commands found".
					initialItems: SLASH_COMMANDS,
				},
				SlashCommandsList,
			),
		}),
		PageLinks.configure({
			suggestion: createSuggestionMenu(
				{
					items: ({ query }) =>
						pickerItems(spacePages(), query, props.documentKey),
				},
				PageLinkList,
				({ query }) => ({ query, spaceName: spaceStore.doc?.space_name }),
			),
			findPage: (title) =>
				findPageByTitle(
					spacePages().filter((page) => page.key !== props.documentKey),
					title,
				),
			createPage: createPageBesideThis,
		}),
	],
	onUpdate: handleContentChange,
	onBlur: () => contentSync.flush(),
});

// useEditor doesn't take editorProps; set them on the created instance.
editor.value.setOptions({
	editorProps: {
		handlePaste,
		handleDrop,
		transformPasted,
	},
});

// Typography comes from EditorContent's own `prose prose-v3` defaults; these
// classes only hook wiki-specific rules in wiki-editor-content.css.
const contentClass = [
	'wiki-editor-content',
	props.readonly ? '' : 'is-editable',
];

// The editor's width is the viewport minus the app nav, so a viewport media
// query would measure the wrong box — watch the element instead. The rail is
// given its gutter rather than floating over whatever the centred column
// leaves behind, so the threshold is the 768px prose column plus that one
// reserve — not a rail's width on each side, which needed a 1400px window.
// Below it the strip takes over.
const TOC_RAIL_RESERVE = 240;
const TOC_RAIL_MIN_WIDTH = 768 + TOC_RAIL_RESERVE;
const { width: containerWidth } = useElementSize(containerRef);
const showTocRail = computed(
	() => props.showOutline && containerWidth.value >= TOC_RAIL_MIN_WIDTH,
);
// Width reads 0 until the first ResizeObserver callback; rendering neither
// variant until then avoids flashing the narrow strip on a wide screen.
const showTocStrip = computed(
	() => props.showOutline && containerWidth.value > 0 && !showTocRail.value,
);

function normalizeMarkdown(content) {
	return canonicalizeMarkdown(editor.value?.markdown, content);
}

const normalizedSavedContent = memoizeLast(normalizeMarkdown);

// Keyed on the doc, not the markdown string: the doc is immutable, and the
// cache must also skip the serialize step.
const markdownForDoc = memoizeLast(() => {
	const markdown = editor.value?.getMarkdown();
	return markdown === undefined ? undefined : normalizeMarkdown(markdown);
});

function getMarkdown() {
	if (!editor.value) return undefined;
	return markdownForDoc(editor.value.state.doc);
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
		normalizedSavedContent(props.savedContent),
		props.documentKey,
	);
}

function handleContentChange() {
	forgetRemovedUploads();
	if (autosaveTimer) {
		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}
	contentSync.schedule();
}

function reportContentChange() {
	const currentContent = getMarkdown();
	if (currentContent === undefined) return;
	emitContentChange();

	if (currentContent === normalizedSavedContent(props.savedContent)) return;

	autosaveTimer = setTimeout(() => {
		autosaveTimer = null;
		autoSave();
	}, AUTOSAVE_DELAY);
}

async function autoSave() {
	if (!editor.value) return;
	contentSync.cancel();

	// Notify components to sync their content before we read it
	document.dispatchEvent(new CustomEvent('wiki-editor-before-save'));

	const currentContent = getMarkdown();
	if (currentContent === undefined) return;
	emitContentChange();
	if (currentContent === normalizedSavedContent(props.savedContent)) return;

	emit('save', currentContent);
	document.dispatchEvent(new CustomEvent('wiki-editor-after-save'));
}

function saveToDB() {
	// Read-only documents (git-synced spaces) never write back.
	if (props.readonly) return;
	contentSync.cancel();
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
		if (markdown !== normalizedSavedContent(props.savedContent)) {
			emit('save', markdown);
		}
		// "Save" means all of the user's work, not just this page.
		emit('save-all');
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
	emitContentReady();
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
	// Nodes leave with the editor, so its uploads can no longer reach the page.
	draftStore.clearUploads(editorUploadIds);
	// Hide any open link popup
	hideLinkPopup();
	// Clean up window reference
	delete window.wikiEditor;
});
</script>

