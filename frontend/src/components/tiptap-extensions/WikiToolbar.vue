<template>
    <div class="wiki-toolbar" v-if="editor">
        <div class="toolbar-group">
            <!-- Headings dropdown -->
            <div class="toolbar-dropdown" ref="headingsDropdown">
                <button
                    class="toolbar-btn dropdown-trigger"
                    @click="toggleHeadingsDropdown"
                    :title="'Headings'"
                >
                    <component :is="currentHeadingIcon" class="icon" />
                    <svg class="dropdown-arrow" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                    </svg>
                </button>
                <div v-show="showHeadingsDropdown" class="toolbar-dropdown-menu">
                    <button
                        v-for="level in [1, 2, 3, 4, 5, 6]"
                        :key="level"
                        class="dropdown-item"
                        :class="{ active: editor.isActive('heading', { level }) }"
                        @click="setHeading(level)"
                    >
                        <component :is="headingIcons[level]" class="icon" />
                        <span>Heading {{ level }}</span>
                    </button>
                    <button
                        class="dropdown-item"
                        :class="{ active: editor.isActive('paragraph') }"
                        @click="setParagraph"
                    >
                        <TextIcon class="icon" />
                        <span>Paragraph</span>
                    </button>
                </div>
            </div>

            <div class="toolbar-separator"></div>

            <!-- Text formatting -->
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('bold') }"
                @click="editor.chain().focus().toggleBold().run()"
                title="Bold (Cmd+B)"
            >
                <BoldIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('italic') }"
                @click="editor.chain().focus().toggleItalic().run()"
                title="Italic (Cmd+I)"
            >
                <ItalicIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('strike') }"
                @click="editor.chain().focus().toggleStrike().run()"
                title="Strikethrough"
            >
                <StrikethroughIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('code') }"
                @click="editor.chain().focus().toggleCode().run()"
                title="Inline Code"
            >
                <CodeIcon class="icon" />
            </button>

            <div class="toolbar-separator"></div>

            <!-- Lists -->
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('bulletList') }"
                @click="editor.chain().focus().toggleBulletList().run()"
                title="Bullet List"
            >
                <ListIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('orderedList') }"
                @click="editor.chain().focus().toggleOrderedList().run()"
                title="Numbered List"
            >
                <ListOrderedIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('taskList') }"
                @click="editor.chain().focus().toggleTaskList().run()"
                title="Task List"
            >
                <ListChecksIcon class="icon" />
            </button>

            <div class="toolbar-separator"></div>

            <!-- Block elements -->
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('blockquote') }"
                @click="editor.chain().focus().toggleBlockquote().run()"
                title="Blockquote"
            >
                <QuoteIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('codeBlock') }"
                @click="editor.chain().focus().toggleCodeBlock().run()"
                title="Code Block"
            >
                <CodeBlockIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                @click="editor.chain().focus().setHorizontalRule().run()"
                title="Horizontal Rule"
            >
                <MinusIcon class="icon" />
            </button>

            <div class="toolbar-separator"></div>

            <!-- Table -->
            <button
                class="toolbar-btn"
                @click="insertTable"
                title="Insert Table"
            >
                <TableIcon class="icon" />
            </button>

            <!-- Link -->
            <button
                class="toolbar-btn"
                :class="{ active: editor.isActive('link') }"
                @click="toggleLink"
                title="Insert Link"
            >
                <LinkIcon class="icon" />
            </button>

            <!-- Image -->
            <button
                class="toolbar-btn"
                @click="triggerImageUpload"
                title="Insert Image"
            >
                <ImageIcon class="icon" />
            </button>
            <input
                ref="imageInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleImageSelect"
            />

            <!-- Video -->
            <button
                class="toolbar-btn"
                @click="editor.chain().focus().selectAndUploadVideo().run()"
                title="Insert Video"
            >
                <VideoIcon class="icon" />
            </button>

            <div class="toolbar-separator"></div>

            <!-- Undo/Redo -->
            <button
                class="toolbar-btn"
                @click="editor.chain().focus().undo().run()"
                :disabled="!editor.can().undo()"
                title="Undo (Cmd+Z)"
            >
                <UndoIcon class="icon" />
            </button>
            <button
                class="toolbar-btn"
                @click="editor.chain().focus().redo().run()"
                :disabled="!editor.can().redo()"
                title="Redo (Cmd+Shift+Z)"
            >
                <RedoIcon class="icon" />
            </button>
        </div>
    </div>
</template>

<script setup>
import {
	LucideBold as BoldIcon,
	LucideSquareCode as CodeBlockIcon,
	LucideCode as CodeIcon,
	LucideHeading1 as H1Icon,
	LucideHeading2 as H2Icon,
	LucideHeading3 as H3Icon,
	LucideHeading4 as H4Icon,
	LucideHeading5 as H5Icon,
	LucideHeading6 as H6Icon,
	LucideImage as ImageIcon,
	LucideItalic as ItalicIcon,
	LucideLink as LinkIcon,
	LucideListChecks as ListChecksIcon,
	LucideList as ListIcon,
	LucideListOrdered as ListOrderedIcon,
	LucideMinus as MinusIcon,
	LucideQuote as QuoteIcon,
	LucideRedo2 as RedoIcon,
	LucideStrikethrough as StrikethroughIcon,
	LucideTable as TableIcon,
	LucideType as TextIcon,
	LucideUndo2 as UndoIcon,
	LucideVideo as VideoIcon,
} from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
	editor: {
		type: Object,
		required: true,
	},
});

const emit = defineEmits(['uploadImage']);

const showHeadingsDropdown = ref(false);
const headingsDropdown = ref(null);
const imageInput = ref(null);

const headingIcons = {
	1: H1Icon,
	2: H2Icon,
	3: H3Icon,
	4: H4Icon,
	5: H5Icon,
	6: H6Icon,
};

const currentHeadingIcon = computed(() => {
	if (!props.editor) return TextIcon;
	for (let level = 1; level <= 6; level++) {
		if (props.editor.isActive('heading', { level })) {
			return headingIcons[level];
		}
	}
	return TextIcon;
});

function toggleHeadingsDropdown() {
	showHeadingsDropdown.value = !showHeadingsDropdown.value;
}

function setHeading(level) {
	props.editor.chain().focus().toggleHeading({ level }).run();
	showHeadingsDropdown.value = false;
}

function setParagraph() {
	props.editor.chain().focus().setParagraph().run();
	showHeadingsDropdown.value = false;
}

function insertTable() {
	props.editor
		.chain()
		.focus()
		.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
		.run();
}

function toggleLink() {
	// Use the openLinkEditor command from our custom link extension
	props.editor.commands.openLinkEditor();
}

function triggerImageUpload() {
	imageInput.value?.click();
}

function handleImageSelect(event) {
	const file = event.target.files?.[0];
	if (file) {
		emit('uploadImage', file);
	}
	// Reset input so same file can be selected again
	event.target.value = '';
}

// Close dropdown when clicking outside
function handleClickOutside(event) {
	if (
		headingsDropdown.value &&
		!headingsDropdown.value.contains(event.target)
	) {
		showHeadingsDropdown.value = false;
	}
}

onMounted(() => {
	document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
	document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.wiki-toolbar {
    display: flex;
    align-items: center;
    padding: 0.5rem;
    background-color: var(--surface-white, #ffffff);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-bottom: none;
    border-radius: 0.5rem 0.5rem 0 0;
    position: sticky;
    top: 0;
    z-index: 40;
}

.toolbar-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--ink-gray-7, #374151);
    cursor: pointer;
    transition: all 0.15s ease;
}

.toolbar-btn:hover:not(:disabled) {
    background-color: var(--surface-gray-2, #f3f4f6);
}

.toolbar-btn.active {
    background-color: var(--surface-gray-3, #e5e7eb);
    color: var(--ink-gray-9, #111827);
}

.toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.toolbar-btn .icon {
    width: 1rem;
    height: 1rem;
}

.toolbar-separator {
    width: 1px;
    height: 1.5rem;
    background-color: var(--outline-gray-2, #e5e7eb);
    margin: 0 0.375rem;
}

/* Dropdown styles */
.toolbar-dropdown {
    position: relative;
}

.dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.5rem;
    width: auto;
}

.dropdown-arrow {
    width: 0.75rem;
    height: 0.75rem;
}

.toolbar-dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 0.25rem;
    padding: 0.25rem;
    background-color: var(--surface-white, #ffffff);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    z-index: 50;
    min-width: 150px;
}

.dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--ink-gray-7, #374151);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
}

.dropdown-item:hover {
    background-color: var(--surface-gray-2, #f3f4f6);
}

.dropdown-item.active {
    background-color: var(--surface-gray-3, #e5e7eb);
    color: var(--ink-gray-9, #111827);
}

.dropdown-item .icon {
    width: 1rem;
    height: 1rem;
}

.hidden {
    display: none;
}
</style>
