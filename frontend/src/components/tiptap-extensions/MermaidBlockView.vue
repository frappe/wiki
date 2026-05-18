<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { getMermaid } from './mermaid-loader.js';

const props = defineProps({
	node: { type: Object, required: true },
	updateAttributes: { type: Function, required: true },
	deleteNode: { type: Function, required: true },
	selected: { type: Boolean, default: false },
});

const code = computed(() => props.node.attrs.code || '');
const renderedSvg = ref('');
const errorMessage = ref('');
const isRendering = ref(false);
let renderVersion = 0;

function updateCode(event) {
	props.updateAttributes({ code: event.target.value });
}

async function renderPreview() {
	const source = code.value.trim();
	const version = ++renderVersion;

	if (!source) {
		renderedSvg.value = '';
		errorMessage.value = '';
		return;
	}

	isRendering.value = true;
	try {
		const mermaid = await getMermaid();
		const id = `wiki-mermaid-editor-${Date.now()}-${version}`;
		const result = await mermaid.render(id, source);
		if (version !== renderVersion) return;
		renderedSvg.value = result.svg;
		errorMessage.value = '';
	} catch (error) {
		if (version !== renderVersion) return;
		renderedSvg.value = '';
		errorMessage.value = error?.message || 'Unable to render Mermaid diagram.';
	} finally {
		if (version === renderVersion) {
			isRendering.value = false;
		}
	}
}

watch(
	() => code.value,
	() => nextTick(renderPreview),
	{ immediate: true },
);

onMounted(renderPreview);
</script>

<template>
	<NodeViewWrapper
		class="mermaid-block-wrapper"
		:class="{ 'is-selected': selected }"
		contenteditable="false"
	>
		<div class="mermaid-block-toolbar">
			<span class="mermaid-block-label">Mermaid</span>
			<button type="button" class="mermaid-block-remove" @click="deleteNode()">
				Remove
			</button>
		</div>
		<div class="mermaid-block-body">
			<textarea
				class="mermaid-block-editor"
				:value="code"
				spellcheck="false"
				@input="updateCode"
			/>
			<div class="mermaid-block-preview" aria-live="polite">
				<div v-if="isRendering" class="mermaid-block-empty">Rendering...</div>
				<div
					v-else-if="renderedSvg"
					class="mermaid-block-svg"
					v-html="renderedSvg"
				/>
				<div v-else-if="errorMessage" class="mermaid-block-error">
					{{ errorMessage }}
				</div>
				<div v-else class="mermaid-block-empty">Enter Mermaid code.</div>
			</div>
		</div>
	</NodeViewWrapper>
</template>

<style scoped>
.mermaid-block-wrapper {
	margin: 0.75rem 0;
	border: 1px solid var(--outline-gray-2, #e5e7eb);
	border-radius: 8px;
	background: var(--surface-white, #ffffff);
	overflow: hidden;
	transition: outline-color 0.2s ease;
}

.mermaid-block-wrapper.is-selected {
	outline: 2px solid rgba(59, 130, 246, 0.5);
}

.mermaid-block-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid var(--outline-gray-1, #f3f4f6);
	background: var(--surface-gray-1, #f9fafb);
}

.mermaid-block-label {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--ink-gray-6, #4b5563);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.mermaid-block-remove {
	border: 0;
	background: transparent;
	color: var(--ink-gray-5, #6b7280);
	font-size: 0.75rem;
	cursor: pointer;
}

.mermaid-block-remove:hover {
	color: var(--ink-red-6, #b91c1c);
}

.mermaid-block-body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	min-height: 14rem;
}

.mermaid-block-editor {
	width: 100%;
	min-height: 14rem;
	padding: 0.875rem 1rem;
	border: 0;
	border-right: 1px solid var(--outline-gray-1, #f3f4f6);
	resize: vertical;
	background: var(--surface-gray-1, #f9fafb);
	color: var(--ink-gray-9, #111827);
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
	font-size: 0.8125rem;
	line-height: 1.55;
	outline: none;
}

.mermaid-block-preview {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 0;
	min-height: 14rem;
	padding: 1rem;
	overflow: auto;
}

.mermaid-block-svg {
	max-width: 100%;
}

.mermaid-block-svg :deep(svg) {
	max-width: 100%;
	height: auto;
}

.mermaid-block-empty,
.mermaid-block-error {
	font-size: 0.8125rem;
	color: var(--ink-gray-5, #6b7280);
	text-align: center;
}

.mermaid-block-error {
	color: var(--ink-red-6, #b91c1c);
}

@media (max-width: 768px) {
	.mermaid-block-body {
		grid-template-columns: 1fr;
	}

	.mermaid-block-editor {
		border-right: 0;
		border-bottom: 1px solid var(--outline-gray-1, #f3f4f6);
	}
}
</style>
