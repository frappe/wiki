<template>
	<div v-if="editor" class="wiki-editor-container">
		<EditorContent :editor="editor" />
	</div>
</template>

<script setup>
import { Extension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { StarterKit } from '@tiptap/starter-kit';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { common, createLowlight } from 'lowlight';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { WikiCodeBlock } from './tiptap-extensions/code-block-extension.js';
import { CalloutBlock } from './tiptap-extensions/callout-block.js';
import { IframeBlock } from './tiptap-extensions/iframe-block.js';
import { MermaidBlock } from './tiptap-extensions/mermaid-block.js';
import { WikiImage } from './tiptap-extensions/image-extension.js';
import { WikiLink } from './tiptap-extensions/link-extension.js';
import { PdfBlock } from './tiptap-extensions/pdf-block.js';
import { VideoBlock } from './tiptap-extensions/video-block.js';

// A read-only render of wiki markdown through the same TipTap extensions the
// editor uses, so previews match what readers see — lowlight syntax
// highlighting, callouts, iframes, PDFs and videos all render natively rather
// than as plain server HTML.
const props = defineProps({
	content: { type: String, default: '' },
});

const lowlight = createLowlight(common);
const editor = ref(null);

// Mirror of WikiEditor's blank-line preservation so spacing matches the editor.
const PreserveBlankLines = Extension.create({
	name: 'preserveBlankLines',
	markdownTokenName: 'space',
	parseMarkdown(token) {
		const count = Math.floor(token.raw.length / 2) - 1;
		if (count <= 0) return null;
		return Array.from({ length: count }, () => ({ type: 'paragraph' }));
	},
});

onMounted(() => {
	editor.value = new Editor({
		editable: false,
		extensions: [
			StarterKit.configure({
				codeBlock: false, // WikiCodeBlock (lowlight) instead
				link: false, // WikiLink instead
			}),
			WikiLink.configure({
				openOnClick: true,
				HTMLAttributes: { rel: 'noopener noreferrer' },
			}),
			Markdown.configure({ markedOptions: { breaks: true } }),
			PreserveBlankLines,
			WikiImage.configure({ inline: false, allowBase64: true }),
			Table.configure({ resizable: false }),
			TableRow,
			TableCell,
			TableHeader,
			TaskList,
			TaskItem.configure({ nested: true }),
			WikiCodeBlock.configure({ lowlight }),
			CalloutBlock,
			IframeBlock,
			MermaidBlock,
			PdfBlock,
			VideoBlock.configure({ uploadFunction: () => {} }),
		],
		content: props.content || '',
		contentType: 'markdown',
		editorProps: {
			attributes: {
				class:
					'prose prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none prose-code:bg-transparent prose-code:p-0 prose-code:font-normal prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:border-outline-gray-2 prose-th:border-outline-gray-2 prose-td:relative prose-th:relative prose-th:bg-surface-gray-2 prose-a:underline prose-a:[text-underline-offset:2px] prose-a:[word-break:break-all] hover:prose-a:text-ink-gray-7 wiki-editor-content',
			},
		},
	});
});

watch(
	() => props.content,
	(content) => {
		if (editor.value) {
			editor.value.commands.setContent(content || '', { contentType: 'markdown' });
		}
	},
);

onBeforeUnmount(() => {
	editor.value?.destroy();
});
</script>
