<script setup>
/**
 * PdfBlockView
 *
 * In-editor preview card for an embedded PDF: a first-page thumbnail (rendered
 * with PDF.js via vue-pdf-embed) plus filename + page count, which opens a
 * full-screen viewer on click. Handles the upload lifecycle states
 * (loading / error) set by WikiEditor's insertAndUploadPdf.
 */

import { computed, ref } from 'vue';
import { NodeViewWrapper } from '@tiptap/vue-3';
import VuePdfEmbed from 'vue-pdf-embed';
import {
	LucideDownload,
	LucideFileText,
	LucideMaximize2,
	LucideTrash2,
} from 'lucide-vue-next';
import PdfViewerModal from './PdfViewerModal.vue';

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
	selected: {
		type: Boolean,
		default: false,
	},
	editor: {
		type: Object,
		required: true,
	},
});

const src = computed(() => props.node.attrs.src || '');
const filename = computed(() => props.node.attrs.filename || 'Document.pdf');
const loading = computed(() => !!props.node.attrs.loading);
const error = computed(() => props.node.attrs.error);

const pageCount = ref(null);
const thumbError = ref(false);
const showViewer = ref(false);

function onLoaded(doc) {
	pageCount.value = doc?.numPages ?? null;
}

function onThumbError() {
	thumbError.value = true;
}

function openViewer() {
	if (src.value && !thumbError.value) {
		showViewer.value = true;
	}
}

function closeViewer() {
	showViewer.value = false;
}
</script>

<template>
	<NodeViewWrapper
		class="wiki-pdf-wrapper"
		:class="{ 'is-selected': selected }"
		contenteditable="false"
	>
		<!-- Loading state -->
		<div v-if="loading" class="wiki-pdf-card is-loading">
			<div class="wiki-pdf-header">
				<LucideFileText class="wiki-pdf-icon" :size="18" />
				<span class="wiki-pdf-name">{{ filename }}</span>
			</div>
			<div class="wiki-pdf-loading-body">
				<span class="wiki-pdf-spinner" />
				<span class="wiki-pdf-loading-text">Uploading…</span>
			</div>
		</div>

		<!-- Error state -->
		<div v-else-if="error" class="wiki-pdf-card is-error">
			<div class="wiki-pdf-header">
				<LucideFileText class="wiki-pdf-icon" :size="18" />
				<span class="wiki-pdf-name">{{ filename }}</span>
				<button
					v-if="editor.isEditable"
					type="button"
					class="wiki-pdf-action"
					title="Remove"
					@click="deleteNode"
				>
					<LucideTrash2 :size="16" />
				</button>
			</div>
			<div class="wiki-pdf-error-body">Upload failed: {{ error }}</div>
		</div>

		<!-- Loaded state -->
		<div v-else class="wiki-pdf-card">
			<div class="wiki-pdf-header">
				<LucideFileText class="wiki-pdf-icon" :size="18" />
				<span class="wiki-pdf-name">{{ filename }}</span>
				<span v-if="pageCount" class="wiki-pdf-pages"
					>{{ pageCount }} {{ pageCount === 1 ? 'page' : 'pages' }}</span
				>
				<div class="wiki-pdf-actions">
					<button
						type="button"
						class="wiki-pdf-action"
						title="Open viewer"
						@click="openViewer"
					>
						<LucideMaximize2 :size="16" />
					</button>
					<a
						:href="src"
						download
						target="_blank"
						rel="noopener"
						class="wiki-pdf-action"
						title="Download"
					>
						<LucideDownload :size="16" />
					</a>
					<button
						v-if="editor.isEditable"
						type="button"
						class="wiki-pdf-action"
						title="Remove"
						@click="deleteNode"
					>
						<LucideTrash2 :size="16" />
					</button>
				</div>
			</div>
			<div class="wiki-pdf-scroll" :class="{ 'is-unavailable': thumbError }">
				<VuePdfEmbed
					v-if="src && !thumbError"
					:source="src"
					:width="820"
					@loaded="onLoaded"
					@loading-failed="onThumbError"
					@rendering-failed="onThumbError"
				/>
				<div v-if="thumbError" class="wiki-pdf-thumb-fallback">
					<LucideFileText :size="40" />
					<span>Preview unavailable</span>
				</div>
			</div>
		</div>

		<PdfViewerModal
			v-if="showViewer"
			:src="src"
			:filename="filename"
			@close="closeViewer"
		/>
	</NodeViewWrapper>
</template>

<style scoped>
.wiki-pdf-wrapper {
	display: block;
	margin: 1rem 0;
}

.wiki-pdf-card {
	border: 1px solid var(--outline-gray-2, #e5e7eb);
	border-radius: 0.5rem;
	overflow: hidden;
	background: var(--surface-white, #ffffff);
}

.wiki-pdf-wrapper.is-selected .wiki-pdf-card {
	outline: 2px solid var(--primary, #171717);
	outline-offset: 2px;
}

.wiki-pdf-header {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.625rem 0.75rem;
	border-bottom: 1px solid var(--outline-gray-2, #e5e7eb);
	background: var(--surface-gray-1, #f9fafb);
}

.wiki-pdf-icon {
	flex-shrink: 0;
	color: var(--ink-red-5, #dc2626);
}

.wiki-pdf-name {
	font-size: 0.875rem;
	font-weight: 500;
	color: var(--ink-gray-9, #111827);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.wiki-pdf-pages {
	flex-shrink: 0;
	font-size: 0.75rem;
	color: var(--ink-gray-5, #6b7280);
}

.wiki-pdf-actions {
	display: flex;
	align-items: center;
	gap: 0.125rem;
	margin-left: auto;
	flex-shrink: 0;
}

.wiki-pdf-action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border: none;
	border-radius: 0.375rem;
	background: transparent;
	color: var(--ink-gray-6, #4b5563);
	cursor: pointer;
	text-decoration: none;
	transition: background-color 0.15s ease;
}

.wiki-pdf-action:hover {
	background: var(--surface-gray-3, #e5e7eb);
	color: var(--ink-gray-9, #111827);
}

.wiki-pdf-scroll {
	position: relative;
	display: block;
	max-height: 600px;
	overflow-y: auto;
	padding: 1rem;
	background: var(--surface-gray-2, #f3f4f6);
}

/* vue-pdf-embed wraps each page; keep wrappers full-width so width:100% on the
   canvas resolves against the card width (not a stretched flex line). */
.wiki-pdf-scroll :deep(.vue-pdf-embed),
.wiki-pdf-scroll :deep(.vue-pdf-embed > div) {
	width: 100%;
}

.wiki-pdf-scroll :deep(canvas) {
	width: 100% !important;
	height: auto !important;
	display: block;
	margin: 0 auto 1rem;
	box-shadow: 0 1px 6px rgba(0, 0, 0, 0.15);
}

.wiki-pdf-scroll :deep(canvas:last-child) {
	margin-bottom: 0;
}

.wiki-pdf-thumb-fallback {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	padding: 2.5rem 1rem;
	color: var(--ink-gray-5, #6b7280);
	font-size: 0.8125rem;
}

/* Loading + error bodies */
.wiki-pdf-loading-body,
.wiki-pdf-error-body {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	padding: 2rem 1rem;
	font-size: 0.8125rem;
	color: var(--ink-gray-6, #4b5563);
}

.wiki-pdf-error-body {
	color: var(--ink-red-5, #dc2626);
}

.wiki-pdf-spinner {
	width: 1.25rem;
	height: 1.25rem;
	border: 2px solid var(--outline-gray-3, #d1d5db);
	border-top-color: var(--ink-gray-7, #374151);
	border-radius: 50%;
	animation: wiki-pdf-spin 0.7s linear infinite;
}

@keyframes wiki-pdf-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
