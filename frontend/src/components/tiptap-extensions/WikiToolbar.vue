<template>
	<div class="wiki-toolbar" v-if="editor">
		<EditorFixedMenu class="toolbar-group" :editor="editor" :items="toolbarItems" />
		<input
			ref="imageInput"
			type="file"
			accept="image/*"
			class="hidden"
			@change="handleImageSelect"
		/>
	</div>
</template>

<script setup>
import {
	Blockquote,
	Bold,
	BulletList,
	EditorFixedMenu,
	H1,
	H2,
	H3,
	H4,
	H5,
	H6,
	HorizontalRule,
	InlineCode,
	InsertLink,
	InsertTable,
	Italic,
	OrderedList,
	Redo,
	Separator,
	Strike,
	Undo,
} from 'frappe-ui/editor';
import { ref } from 'vue';

const props = defineProps({
	editor: {
		type: Object,
		required: true,
	},
});

const emit = defineEmits(['uploadImage']);

const imageInput = ref(null);

// Atoms exist only for items whose command lives in frappe-ui's kits; the
// rest (task list via @tiptap/extension-list, code block, PDF block,
// file-input image upload) get hand-rolled MenuItem objects with the same
// shape.
const TaskListItem = {
	icon: 'lucide-list-checks',
	label: 'Task List',
	action: (editor) => editor.chain().focus().toggleTaskList().run(),
	isActive: (editor) => editor.isActive('taskList'),
};

const CodeBlockItem = {
	icon: 'lucide-square-code',
	label: 'Code Block',
	action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
	isActive: (editor) => editor.isActive('codeBlock'),
};

const InsertImageItem = {
	icon: 'lucide-image',
	label: 'Insert Image',
	action: () => {
		imageInput.value?.click();
	},
};

const InsertPdfItem = {
	icon: 'lucide-file-text',
	label: 'Insert PDF',
	action: (editor) => editor.chain().focus().selectAndUploadPdf().run(),
};

// frappe-ui's InsertVideo atom gates on a node named `video`; wiki's video
// node is `videoBlock`, so the atom hides itself and we roll our own.
const InsertVideoItem = {
	icon: 'lucide-video',
	label: 'Insert Video',
	action: (editor) => editor.chain().focus().selectAndUploadVideo().run(),
};

const HeadingGroup = {
	type: 'group',
	label: 'Heading',
	items: [H1, H2, H3, H4, H5, H6],
};

const toolbarItems = [
	HeadingGroup,
	Separator,
	Bold,
	Italic,
	Strike,
	InlineCode,
	Separator,
	BulletList,
	OrderedList,
	TaskListItem,
	Separator,
	Blockquote,
	CodeBlockItem,
	HorizontalRule,
	Separator,
	InsertTable,
	InsertLink,
	InsertImageItem,
	InsertVideoItem,
	InsertPdfItem,
	Separator,
	Undo,
	Redo,
];

function handleImageSelect(event) {
	const file = event.target.files?.[0];
	if (file) {
		emit('uploadImage', file);
	}
	// Reset input so same file can be selected again
	event.target.value = '';
}
</script>

<style scoped>
.wiki-toolbar {
    display: flex;
    align-items: center;
    padding: 0.375rem 1.25rem;
    background-color: var(--surface-base, #ffffff);
    border-bottom: 1px solid var(--outline-gray-2, #e5e7eb);
    position: sticky;
    top: 0;
    z-index: 40;
}

.hidden {
    display: none;
}

/* On a phone the ~20 buttons can't fit; let the row scroll horizontally
   (keeping it sticky-top) instead of hiding the right-hand actions. */
@media (max-width: 767px) {
    .wiki-toolbar {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none; /* Firefox */
    }
    .wiki-toolbar::-webkit-scrollbar {
        display: none; /* Chrome/Safari */
    }
    /* Keep every control at its full size and let them overflow to scroll,
       rather than compressing to fit. */
    .toolbar-group :deep(> *) {
        flex-shrink: 0;
    }
    /* 44x44 minimum touch target. */
    .toolbar-group :deep(button) {
        min-width: 2.75rem;
        min-height: 2.75rem;
    }
}
</style>
