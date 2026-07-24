<template>
	<div class="wiki-editor-container">
		<!-- Typography comes from EditorContent's own `prose prose-v3` defaults;
		     wiki-editor-content only hooks wiki-specific rules. -->
		<EditorContent :editor="editor" class="wiki-editor-content" />
	</div>
</template>

<script setup>
import { TaskItem, TaskList } from '@tiptap/extension-list';
import {
	Table,
	TableCell,
	TableHeader,
	TableRow,
} from '@tiptap/extension-table';
import {
	CodeBlock,
	EditorContent,
	Markdown,
	useEditor,
} from 'frappe-ui/editor';
import { ref, watch } from 'vue';
import { CalloutBlock } from './tiptap-extensions/callout-block.js';
import { IframeBlock } from './tiptap-extensions/iframe-block.js';
import { WikiImage } from './tiptap-extensions/image-extension.js';
import { WikiLink } from './tiptap-extensions/link-extension.js';
import { MermaidBlock } from './tiptap-extensions/mermaid-block.js';
import { PdfBlock } from './tiptap-extensions/pdf-block.js';
import { PreserveBlankLines } from './tiptap-extensions/preserve-blank-lines.js';
import { VideoBlock } from './tiptap-extensions/video-block.js';
import { wikiStarterKit } from './tiptap-extensions/wiki-starterkit.js';

// A read-only render of wiki markdown through the same TipTap extensions the
// editor uses, so previews match what readers see — lowlight syntax
// highlighting, callouts, iframes, PDFs and videos all render natively rather
// than as plain server HTML.
const props = defineProps({
	content: { type: String, default: '' },
});

// Writable mirror of the prop — useEditor owns its content ref bidirectionally
// and syncs the document when this changes.
const content = ref(props.content || '');
watch(
	() => props.content,
	(value) => {
		content.value = value || '';
	},
);

const editor = useEditor({
	content,
	format: 'markdown',
	editable: false,
	extensions: [
		wikiStarterKit(),
		WikiLink.configure({
			openOnClick: true,
			HTMLAttributes: { rel: 'noopener noreferrer' },
		}),
		Markdown.configure({ markedOptions: { breaks: true } }),
		PreserveBlankLines,
		WikiImage.configure({ inline: false, allowBase64: true }),
		Table.configure({ resizable: false, renderWrapper: true }),
		TableRow,
		TableCell,
		TableHeader,
		TaskList,
		TaskItem.configure({ nested: true }),
		CodeBlock,
		CalloutBlock,
		IframeBlock,
		MermaidBlock,
		PdfBlock,
		VideoBlock.configure({ uploadFunction: () => {} }),
	],
});
</script>
