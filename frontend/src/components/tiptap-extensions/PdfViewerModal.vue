<script setup>
/**
 * PdfViewerModal
 *
 * Full-screen, scrollable PDF viewer with zoom + download. Rendered with PDF.js
 * (via vue-pdf-embed). Teleported to <body> so it escapes the editor's stacking
 * context. Used by the editor's PdfBlockView; the public reader has a vanilla
 * equivalent in wiki/public/js/pdf-viewer.js.
 */

import { onMounted, onUnmounted, ref } from 'vue';
import VuePdfEmbed from 'vue-pdf-embed';
import {
	LucideDownload,
	LucideMinus,
	LucidePlus,
	LucideX,
} from 'lucide-vue-next';

const props = defineProps({
	src: {
		type: String,
		required: true,
	},
	filename: {
		type: String,
		default: '',
	},
});

const emit = defineEmits(['close']);

const scale = ref(1.2);

function zoomIn() {
	scale.value = Math.min(Math.round((scale.value + 0.25) * 100) / 100, 4);
}

function zoomOut() {
	scale.value = Math.max(Math.round((scale.value - 0.25) * 100) / 100, 0.5);
}

function onKeydown(event) {
	if (event.key === 'Escape') {
		emit('close');
	}
}

onMounted(() => {
	document.addEventListener('keydown', onKeydown);
	document.body.classList.add('wiki-pdf-modal-open');
});

onUnmounted(() => {
	document.removeEventListener('keydown', onKeydown);
	document.body.classList.remove('wiki-pdf-modal-open');
});
</script>

<template>
	<Teleport to="body">
		<div class="wiki-pdf-modal" @click.self="emit('close')">
			<div class="wiki-pdf-modal-toolbar">
				<span class="wiki-pdf-modal-name" :title="filename">{{
					filename || 'PDF'
				}}</span>
				<div class="wiki-pdf-modal-actions">
					<button
						type="button"
						class="wiki-pdf-modal-btn"
						title="Zoom out"
						@click="zoomOut"
					>
						<LucideMinus :size="16" />
					</button>
					<span class="wiki-pdf-modal-zoom">{{ Math.round(scale * 100) }}%</span>
					<button
						type="button"
						class="wiki-pdf-modal-btn"
						title="Zoom in"
						@click="zoomIn"
					>
						<LucidePlus :size="16" />
					</button>
					<a
						:href="src"
						download
						target="_blank"
						rel="noopener"
						class="wiki-pdf-modal-btn"
						title="Download"
					>
						<LucideDownload :size="16" />
					</a>
					<button
						type="button"
						class="wiki-pdf-modal-btn"
						title="Close (Esc)"
						@click="emit('close')"
					>
						<LucideX :size="16" />
					</button>
				</div>
			</div>
			<div class="wiki-pdf-modal-scroll" @click.self="emit('close')">
				<VuePdfEmbed
					:source="src"
					:scale="scale"
					class="wiki-pdf-modal-doc"
				/>
			</div>
		</div>
	</Teleport>
</template>

<style>
body.wiki-pdf-modal-open {
	overflow: hidden;
}

.wiki-pdf-modal {
	position: fixed;
	inset: 0;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	background: rgba(17, 17, 17, 0.75);
	backdrop-filter: blur(2px);
}

.wiki-pdf-modal-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.625rem 1rem;
	background: var(--surface-white, #ffffff);
	border-bottom: 1px solid var(--outline-gray-2, #e5e7eb);
	flex-shrink: 0;
}

.wiki-pdf-modal-name {
	font-size: 0.875rem;
	font-weight: 500;
	color: var(--ink-gray-9, #111827);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.wiki-pdf-modal-actions {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	flex-shrink: 0;
}

.wiki-pdf-modal-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border: none;
	border-radius: 0.375rem;
	background: transparent;
	color: var(--ink-gray-7, #374151);
	cursor: pointer;
	text-decoration: none;
	transition: background-color 0.15s ease;
}

.wiki-pdf-modal-btn:hover {
	background: var(--surface-gray-2, #f3f4f6);
}

.wiki-pdf-modal-zoom {
	min-width: 3rem;
	text-align: center;
	font-size: 0.8125rem;
	color: var(--ink-gray-6, #4b5563);
	font-variant-numeric: tabular-nums;
}

.wiki-pdf-modal-scroll {
	flex: 1;
	overflow: auto;
	padding: 1.5rem;
	display: flex;
	justify-content: center;
}

.wiki-pdf-modal-doc {
	width: max-content;
	max-width: 100%;
	height: max-content;
}

/* Page separation + shadow inside the viewer */
.wiki-pdf-modal-doc :deep(.vue-pdf-embed__page) {
	margin: 0 auto 1rem;
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
}

.wiki-pdf-modal-doc :deep(canvas) {
	display: block;
}
</style>
