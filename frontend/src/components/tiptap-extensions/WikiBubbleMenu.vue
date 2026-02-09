<template>
    <BubbleMenu
        v-if="editor"
        :editor="editor"
        :should-show="shouldShowBubbleMenu"
        :tippy-options="{
            duration: 100,
            maxWidth: 'none',
            zIndex: 50,
            popperOptions: {
                modifiers: [
                    {
                        name: 'preventOverflow',
                        options: {
                            boundary: 'viewport',
                            padding: 8
                        }
                    },
                    {
                        name: 'flip',
                        options: {
                            fallbackPlacements: ['top', 'bottom', 'right']
                        }
                    }
                ]
            }
        }"
        class="wiki-bubble-menu"
    >
        <div class="bubble-menu-buttons">
            <!-- Text formatting -->
            <button
                @click="editor.chain().focus().toggleBold().run()"
                :class="{ 'is-active': editor.isActive('bold') }"
                title="Bold (Ctrl+B)"
            >
                <Bold :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleItalic().run()"
                :class="{ 'is-active': editor.isActive('italic') }"
                title="Italic (Ctrl+I)"
            >
                <Italic :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleStrike().run()"
                :class="{ 'is-active': editor.isActive('strike') }"
                title="Strikethrough"
            >
                <Strikethrough :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleCode().run()"
                :class="{ 'is-active': editor.isActive('code') }"
                title="Inline code"
            >
                <Code :size="16" :stroke-width="2" />
            </button>

            <span class="separator" />

            <!-- Link -->
            <button @click="toggleLink" :class="{ 'is-active': editor.isActive('link') }" title="Link">
                <Link :size="16" :stroke-width="2" />
            </button>

            <span class="separator" />

            <!-- Headings -->
            <button
                @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
                :class="{ 'is-active': editor.isActive('heading', { level: 1 }) }"
                title="Heading 1"
            >
                <Heading1 :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
                :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }"
                title="Heading 2"
            >
                <Heading2 :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
                :class="{ 'is-active': editor.isActive('heading', { level: 3 }) }"
                title="Heading 3"
            >
                <Heading3 :size="16" :stroke-width="2" />
            </button>

            <span class="separator" />

            <!-- Lists -->
            <button
                @click="editor.chain().focus().toggleBulletList().run()"
                :class="{ 'is-active': editor.isActive('bulletList') }"
                title="Bullet list"
            >
                <List :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleOrderedList().run()"
                :class="{ 'is-active': editor.isActive('orderedList') }"
                title="Numbered list"
            >
                <ListOrdered :size="16" :stroke-width="2" />
            </button>

            <span class="separator" />

            <!-- Quote and code block -->
            <button
                @click="editor.chain().focus().toggleBlockquote().run()"
                :class="{ 'is-active': editor.isActive('blockquote') }"
                title="Blockquote"
            >
                <Quote :size="16" :stroke-width="2" />
            </button>
            <button
                @click="editor.chain().focus().toggleCodeBlock().run()"
                :class="{ 'is-active': editor.isActive('codeBlock') }"
                title="Code block"
            >
                <FileCode :size="16" :stroke-width="2" />
            </button>
        </div>
    </BubbleMenu>
</template>

<script setup>
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import {
	Bold,
	Code,
	FileCode,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	Link,
	List,
	ListOrdered,
	Quote,
	Strikethrough,
} from 'lucide-vue-next';

const props = defineProps({
	editor: {
		type: Object,
		required: true,
	},
});

function shouldShowBubbleMenu({ editor, state }) {
	const selection = state.selection;

	// Bubble menu is only for inline text formatting, not media/node selections.
	if (selection instanceof NodeSelection) return false;
	if (selection.empty) return false;
	if (editor.isActive('videoBlock')) return false;
	if (editor.isActive('image')) return false;

	return true;
}

function toggleLink() {
	// Use the openLinkEditor command from our custom link extension
	props.editor.commands.openLinkEditor();
}
</script>

<style scoped>
.wiki-bubble-menu {
    display: flex;
}

.bubble-menu-buttons {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    background: var(--surface-white, #ffffff);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.5rem;
    padding: 0.25rem;
    box-shadow:
        0 4px 6px -1px rgb(0 0 0 / 0.1),
        0 2px 4px -2px rgb(0 0 0 / 0.1);
}

.bubble-menu-buttons button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--ink-gray-6, #4b5563);
    transition: all 0.15s ease;
}

.bubble-menu-buttons button:hover {
    background: var(--surface-gray-2, #f3f4f6);
    color: var(--ink-gray-9, #111827);
}

.bubble-menu-buttons button.is-active {
    background: var(--surface-gray-3, #e5e7eb);
    color: var(--ink-gray-9, #111827);
}

.separator {
    width: 1px;
    height: 20px;
    background: var(--outline-gray-2, #e5e7eb);
    margin: 0 0.25rem;
}
</style>
