<script setup>
import { useNodeViewEditable } from '@/composables/useNodeViewEditable';
import { NodeViewWrapper } from '@tiptap/vue-3';
import { watchDebounced } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getMermaid } from './mermaid-loader.js';

const props = defineProps({
	node: { type: Object, required: true },
	updateAttributes: { type: Function, required: true },
	deleteNode: { type: Function, required: true },
	selected: { type: Boolean, default: false },
	editor: { type: Object, required: true },
});

// In a read-only render (e.g. the change-request preview / published viewer)
// we drop the split-pane editing chrome and show only the rendered diagram,
// presented as a centered figure like the public page.
const isEditable = useNodeViewEditable(props.editor);
const isReadOnly = computed(() => !isEditable.value);

const code = computed(() => props.node.attrs.code || '');
const hasCode = computed(() => code.value.trim() !== '');

// Pele's mount() keeps the last good drawing (dimmed, with the error) while the
// source is mid-edit, and follows theme tokens through CSS without a redraw.
const diagramElement = ref(null);
let diagram = null;
let diagramHost = null;

function updateCode(event) {
	props.updateAttributes({ code: event.target.value });
}

async function renderDiagram() {
	if (!hasCode.value) return;
	let mountMermaid;
	try {
		mountMermaid = await getMermaid();
	} catch (error) {
		console.error('Failed to load Mermaid renderer:', error);
		return;
	}
	const host = diagramElement.value;
	if (!host || !hasCode.value) return;
	if (host === diagramHost) {
		diagram.update(code.value.trim());
		return;
	}
	// Toggling read-only swaps the wrapper, so the diagram moves to a new host.
	diagram?.destroy();
	diagram = mountMermaid(host, code.value.trim());
	diagramHost = host;
}

// Debounced: a large diagram takes long enough to draw that typing would lag.
watchDebounced(code, renderDiagram, { debounce: 300, maxWait: 1000 });
watch(diagramElement, renderDiagram, { flush: 'post' });
onBeforeUnmount(() => diagram?.destroy());
</script>

<template>
	<NodeViewWrapper
		v-if="isReadOnly"
		class="mermaid-figure"
		contenteditable="false"
	>
		<div ref="diagramElement" class="mermaid-diagram" />
	</NodeViewWrapper>

	<NodeViewWrapper
		v-else
		class="mermaid-block"
		:class="{ 'is-selected': selected }"
		contenteditable="false"
	>
		<div class="mermaid-block-header">
			<span class="mermaid-block-title">
				<span class="lucide-network mermaid-block-title-icon" aria-hidden="true" />
				Mermaid diagram
			</span>
			<div class="mermaid-block-actions">
				<a
					class="mermaid-block-action"
					href="https://github.com/mermaid-js/mermaid"
					target="_blank"
					rel="noopener noreferrer"
					title="Learn about Mermaid"
				>
					<span class="lucide-circle-help mermaid-block-action-icon" aria-hidden="true" />
				</a>
				<button
					type="button"
					class="mermaid-block-action mermaid-block-delete"
					title="Remove diagram"
					@click="deleteNode()"
				>
					<span class="lucide-trash-2 mermaid-block-action-icon" aria-hidden="true" />
				</button>
			</div>
		</div>

		<div class="mermaid-block-body">
			<div class="mermaid-block-pane mermaid-block-code-pane">
				<textarea
					class="mermaid-block-code"
					:value="code"
					spellcheck="false"
					placeholder="flowchart TD&#10;  A[Start] --> B[End]"
					@input="updateCode"
				/>
			</div>

			<div class="mermaid-block-pane mermaid-block-preview-pane">
				<div class="mermaid-block-preview" aria-live="polite">
					<div v-show="hasCode" ref="diagramElement" class="mermaid-diagram" />
					<div v-if="!hasCode" class="mermaid-block-placeholder">
						Start typing Mermaid to preview your diagram.
					</div>
				</div>
			</div>
		</div>
	</NodeViewWrapper>
</template>

<style scoped>
/* Read-only render (CR preview / published viewer): a centered figure on a
   soft surface, mirroring the public page's .prose pre.mermaid styling. */
.mermaid-figure {
	padding: 2rem 1.5rem;
	margin: 1.5rem 0;
	background: var(--surface-gray-1);
	border: 1px solid var(--outline-gray-2);
	border-radius: 0.75rem;
	overflow-x: auto;
}

/* Pele measures this box to fit the diagram, so it must not shrink to its
   content. Colors come from wiki/public/css/diagrams.css. */
.mermaid-diagram {
	width: 100%;
}

.mermaid-diagram :deep(svg) {
	margin-inline: auto;
}

/* Pele pulls the error up over the drawing's bottom edge (inline style), where
   it covers legends and labels while the author types. Show it below instead.
   Only that variant has a title; the standalone one keeps its caret aligned. */
.mermaid-diagram :deep(.pele-error[title]) {
	margin-top: 0.5rem !important;
	text-align: center;
}

/* Edge labels are backed with --pele-bg; match the editor's white preview pane. */
.mermaid-block :deep(.pele) {
	--pele-bg: var(--surface-base);
}

.mermaid-block {
	margin: 0.75rem 0;
	border: 1px solid var(--outline-gray-2);
	border-radius: 0.5rem;
	background: var(--surface-base);
	overflow: hidden;
	transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.mermaid-block.is-selected {
	border-color: var(--outline-gray-3);
	box-shadow: 0 0 0 2px var(--outline-gray-2);
}

.mermaid-block-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid var(--outline-gray-2);
	background: var(--surface-gray-1);
}

.mermaid-block-title {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--ink-gray-7);
}

.mermaid-block-title-icon {
	width: 0.875rem;
	height: 0.875rem;
}

.mermaid-block-actions {
	display: inline-flex;
	align-items: center;
	gap: 0.125rem;
}

.mermaid-block-action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border: none;
	border-radius: 0.375rem;
	background: transparent;
	color: var(--ink-gray-6);
	cursor: pointer;
	text-decoration: none;
}

.mermaid-block-action:hover {
	background: var(--surface-gray-3);
	color: var(--ink-gray-9);
}

.mermaid-block-delete:hover {
	color: var(--ink-red-4, #dc2626);
}

.mermaid-block-action-icon {
	width: 1rem;
	height: 1rem;
}

.mermaid-block-body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	min-height: 13rem;
}

.mermaid-block-pane {
	min-width: 0;
}

.mermaid-block-code-pane {
	border-right: 1px solid var(--outline-gray-2);
	background: var(--surface-gray-1);
}

.mermaid-block-code {
	width: 100%;
	height: 100%;
	min-height: 13rem;
	padding: 0.875rem 1rem;
	border: 0;
	resize: none;
	background: transparent;
	color: var(--ink-gray-9);
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
		'Liberation Mono', monospace;
	font-size: 0.8125rem;
	line-height: 1.6;
	tab-size: 2;
}

/* Kill the global form focus ring (a blue box-shadow from @tailwindcss/forms);
   the pane already reads as focused via the caret + active editing. */
.mermaid-block-code:focus,
.mermaid-block-code:focus-visible {
	outline: none;
	box-shadow: none;
}

.mermaid-block-code::placeholder {
	color: var(--ink-gray-4);
}

.mermaid-block-preview-pane {
	display: flex;
	flex-direction: column;
	min-height: 13rem;
}

.mermaid-block-preview {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
	overflow: auto;
}

.mermaid-block-placeholder {
	font-size: 0.8125rem;
	color: var(--ink-gray-5);
	text-align: center;
	padding: 0 1rem;
}

@media (max-width: 768px) {
	.mermaid-block-body {
		grid-template-columns: 1fr;
	}

	.mermaid-block-code-pane {
		border-right: 0;
		border-bottom: 1px solid var(--outline-gray-2);
	}
}
</style>
