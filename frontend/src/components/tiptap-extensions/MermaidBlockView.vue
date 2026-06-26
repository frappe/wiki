<script>
// Module-scoped so every mounted block gets a distinct id. A counter inside
// <script setup> resets on each instance, so multiple diagrams would all share
// "mermaid-editor-1" and collide on the same mermaid.render() DOM id —
// cross-contaminating their SVGs (one renders glitchy, another stays blank).
let mermaidInstanceCounter = 0;
function nextMermaidInstanceId() {
	mermaidInstanceCounter += 1;
	return `mermaid-editor-${mermaidInstanceCounter}`;
}
</script>

<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { useStorage, watchDebounced } from '@vueuse/core';
import { CircleHelp, Network, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { getMermaid, getMermaidThemeConfig } from './mermaid-loader.js';

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
const isReadOnly = computed(() => !props.editor.isEditable);

// Unique, collision-free render ids without Date.now()/Math.random() (which
// can collide on rapid keystrokes). One stable instance id per mounted block
// (from the module-scoped counter), plus a monotonically increasing render
// counter within the instance.
const instanceId = nextMermaidInstanceId();
let renderVersion = 0;

const code = computed(() => props.node.attrs.code || '');

// Keep the LAST successfully-rendered SVG on screen even while the current
// source is mid-edit / invalid, so the preview never flickers to blank.
const lastGoodSvg = ref('');
const errorMessage = ref('');
const isRendering = ref(false);

// Theme is the same signal the rest of the SPA uses (see Sidebar.vue /
// DiffViewer.vue): a `wiki-theme` localStorage ref mirrored to <html data-theme>.
// We re-render on flips so the diagram picks up the freshly-resolved Frappe UI
// tokens (the theme itself comes from getMermaidThemeConfig(), not this value).
const userTheme = useStorage('wiki-theme', 'dark');

function updateCode(event) {
	props.updateAttributes({ code: event.target.value });
}

function cleanErrorMessage(error) {
	const message = error?.message || String(error || '');
	// Mermaid prefixes parse errors with a noisy multi-line banner; keep the
	// first meaningful line so the inline hint stays compact.
	return (
		message.split('\n').find((line) => line.trim()) || 'Invalid Mermaid syntax.'
	);
}

async function renderPreview() {
	const source = code.value.trim();
	const version = ++renderVersion;

	if (!source) {
		lastGoodSvg.value = '';
		errorMessage.value = '';
		isRendering.value = false;
		return;
	}

	isRendering.value = true;
	const renderId = `${instanceId}-${version}`;
	try {
		const mermaid = await getMermaid();
		const themeConfig = await getMermaidThemeConfig();
		// Mermaid sizes nodes from the label's measured width; measuring before the
		// web font loads sizes against a narrower fallback and the real font then
		// overflows (the last glyph clips). Wait for fonts so sizing is accurate.
		if (document.fonts?.ready) {
			try {
				await document.fonts.ready;
			} catch {
				/* fonts API unavailable — render anyway */
			}
		}
		if (version !== renderVersion) return;

		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			...themeConfig,
		});

		const { svg } = await mermaid.render(renderId, source);
		if (version !== renderVersion) return;

		lastGoodSvg.value = svg;
		errorMessage.value = '';
	} catch (error) {
		if (version !== renderVersion) return;
		// Keep the last good render visible; just surface the error inline.
		errorMessage.value = cleanErrorMessage(error);
	} finally {
		// On a syntax error mermaid.render() throws but leaves its temporary
		// "d<id>" container (the error "bomb" diagram) attached to <body>. Remove
		// it so a stray bomb never piles up at the bottom of the page while typing.
		document.getElementById(`d${renderId}`)?.remove();
		if (version === renderVersion) {
			isRendering.value = false;
		}
	}
}

// Debounce edits so we don't re-render on every keystroke, but re-render
// immediately when the theme flips.
watchDebounced(code, renderPreview, { debounce: 300, maxWait: 1000 });
watch(userTheme, renderPreview);

onMounted(renderPreview);
</script>

<template>
	<NodeViewWrapper
		v-if="isReadOnly"
		class="mermaid-figure"
		contenteditable="false"
	>
		<div v-if="lastGoodSvg" class="mermaid-figure-svg" v-html="lastGoodSvg" />
		<div v-else-if="isRendering" class="mermaid-figure-placeholder">
			Rendering…
		</div>
		<div v-else class="mermaid-figure-error">
			{{ errorMessage || 'Unable to render this diagram.' }}
		</div>
	</NodeViewWrapper>

	<NodeViewWrapper
		v-else
		class="mermaid-block"
		:class="{ 'is-selected': selected }"
		contenteditable="false"
	>
		<div class="mermaid-block-header">
			<span class="mermaid-block-title">
				<Network class="mermaid-block-title-icon" />
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
					<CircleHelp class="mermaid-block-action-icon" />
				</a>
				<button
					type="button"
					class="mermaid-block-action mermaid-block-delete"
					title="Remove diagram"
					@click="deleteNode()"
				>
					<Trash2 class="mermaid-block-action-icon" />
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
					<div
						v-if="lastGoodSvg"
						class="mermaid-block-svg"
						v-html="lastGoodSvg"
					/>
					<div v-else-if="isRendering" class="mermaid-block-placeholder">
						Rendering…
					</div>
					<div v-else class="mermaid-block-placeholder">
						Start typing Mermaid to preview your diagram.
					</div>
				</div>
				<div v-if="errorMessage" class="mermaid-block-error" role="alert">
					{{ errorMessage }}
				</div>
			</div>
		</div>
	</NodeViewWrapper>
</template>

<style scoped>
/* Read-only render (CR preview / published viewer): a centered figure on a
   soft surface, mirroring the public page's .prose pre.mermaid styling. */
.mermaid-figure {
	display: flex;
	justify-content: center;
	align-items: center;
	padding: 2rem 1.5rem;
	margin: 1.5rem 0;
	background: var(--surface-gray-1);
	border: 1px solid var(--outline-gray-2);
	border-radius: 0.75rem;
	overflow-x: auto;
}

.mermaid-figure-svg {
	max-width: 100%;
}

.mermaid-figure-svg :deep(svg) {
	max-width: 100%;
	height: auto;
}

.mermaid-figure-placeholder {
	font-size: 0.8125rem;
	color: var(--ink-gray-5);
}

.mermaid-figure-error {
	font-size: 0.8125rem;
	color: var(--ink-red-6, #b91c1c);
}

.mermaid-block {
	margin: 0.75rem 0;
	border: 1px solid var(--outline-gray-2);
	border-radius: 0.5rem;
	background: var(--surface-white);
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
	color: var(--ink-red-5, #dc2626);
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

.mermaid-block-svg {
	max-width: 100%;
}

.mermaid-block-svg :deep(svg) {
	max-width: 100%;
	height: auto;
}

.mermaid-block-placeholder {
	font-size: 0.8125rem;
	color: var(--ink-gray-5);
	text-align: center;
	padding: 0 1rem;
}

.mermaid-block-error {
	padding: 0.5rem 0.75rem;
	border-top: 1px solid var(--outline-gray-2);
	background: var(--surface-red-1, #fef2f2);
	color: var(--ink-red-6, #b91c1c);
	font-size: 0.75rem;
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
		'Liberation Mono', monospace;
	white-space: pre-wrap;
	word-break: break-word;
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
