<script setup>
/**
 * IframeBlockView
 *
 * Node view for iframe embeds. Shows a live iframe preview when src is a
 * known provider; otherwise shows a URL input for entering one.
 */

import { NodeViewWrapper } from '@tiptap/vue-3';
import { Button, TextInput } from 'frappe-ui';
import { computed, ref } from 'vue';
import {
	iframeAttrsFromHtml,
	isAllowedIframeSrc,
	matchProvider,
	normalizeEmbedUrl,
} from './iframe-block.js';

const props = defineProps({
	node: { type: Object, required: true },
	updateAttributes: { type: Function, required: true },
	deleteNode: { type: Function, required: true },
	selected: { type: Boolean, default: false },
});

const src = computed(() => props.node.attrs.src || '');
const provider = computed(() => matchProvider(src.value));
const hasValidSrc = computed(() => isAllowedIframeSrc(src.value));

const urlInput = ref('');
const errorMessage = ref('');

function saveUrl() {
	const raw = urlInput.value.trim();

	// Accept a full <iframe …> tag and unpack attrs — users often copy the
	// ready-made embed HTML from YouTube/Vimeo's share dialog.
	const fromHtml = iframeAttrsFromHtml(raw);
	if (fromHtml) {
		errorMessage.value = '';
		props.updateAttributes(fromHtml);
		urlInput.value = '';
		return;
	}

	const normalized = normalizeEmbedUrl(raw);
	if (!isAllowedIframeSrc(normalized)) {
		errorMessage.value =
			'This URL isn’t from a supported provider. Try a YouTube, Vimeo, or other embed URL.';
		return;
	}
	errorMessage.value = '';
	props.updateAttributes({ src: normalized });
	urlInput.value = '';
}

function handleKeyDown(event) {
	if (event.key === 'Enter') {
		event.preventDefault();
		saveUrl();
	}
}
</script>

<template>
	<NodeViewWrapper
		class="iframe-block-wrapper"
		:class="{ 'is-selected': selected }"
		:data-provider="provider"
		contenteditable="false"
	>
		<div v-if="hasValidSrc" class="iframe-container">
			<iframe
				:src="src"
				:title="node.attrs.title || 'Embedded content'"
				:allow="node.attrs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'"
				:allowfullscreen="node.attrs.allowfullscreen"
				:frameborder="node.attrs.frameborder || 0"
				loading="lazy"
				referrerpolicy="strict-origin-when-cross-origin"
			/>
		</div>
		<div v-else class="iframe-placeholder">
			<div class="placeholder-heading">
				<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 7V4a2 2 0 0 1 2-2h3" />
					<path d="M4 17v3a2 2 0 0 0 2 2h3" />
					<path d="M20 7V4a2 2 0 0 0-2-2h-3" />
					<path d="M20 17v3a2 2 0 0 1-2 2h-3" />
					<rect x="7" y="7" width="10" height="10" rx="1" />
				</svg>
				<span>Paste a URL or &lt;iframe&gt; embed code.</span>
			</div>
			<TextInput
				v-model="urlInput"
				class="iframe-placeholder-input"
				type="url"
				placeholder="https://www.youtube.com/watch?v=…"
				@keydown="handleKeyDown"
			/>
			<div class="placeholder-actions">
				<Button variant="solid" @click="saveUrl">Embed</Button>
				<Button variant="subtle" @click="deleteNode()">Remove</Button>
			</div>
			<p v-if="errorMessage" class="placeholder-error">{{ errorMessage }}</p>
		</div>
	</NodeViewWrapper>
</template>

<style scoped>
.iframe-block-wrapper {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	margin: 0.5rem 0;
	border-radius: 8px;
	transition: outline-color 0.2s ease;
}

.iframe-block-wrapper.is-selected {
	outline: 2px solid rgba(59, 130, 246, 0.5);
}

.iframe-container {
	position: relative;
	width: 100%;
	aspect-ratio: 16 / 9;
	overflow: hidden;
	border-radius: 8px;
	background-color: #000;
}

.iframe-container iframe {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	border: 0;
}

.iframe-placeholder {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	padding: 1.25rem;
	border: 1px dashed var(--outline-gray-2, #d1d5db);
	border-radius: 8px;
}

.placeholder-heading {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.875rem;
	color: var(--ink-gray-6, #4b5563);
}

.placeholder-actions {
	display: flex;
	gap: 0.5rem;
}

.placeholder-error {
	margin: 0;
	font-size: 0.8125rem;
	color: var(--ink-red-6, #b91c1c);
}
</style>
