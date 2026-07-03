<template>
    <BubbleMenu
        v-if="editor"
        :editor="editor"
        :should-show="shouldShowBubbleMenu"
        :options="floatingOptions"
        :append-to="appendToBody"
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
import { useMobile } from '@/composables/useMobile';
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

const { isMobile } = useMobile();

// Sticky toolbar height (WikiToolbar measures ~49px); pad a little above it so the
// flip boundary clears the toolbar band with room to spare.
const TOOLBAR_HEIGHT = 56;

const appendToBody = () => document.body;

// Nearest scrollable ancestor of the editor. The sticky toolbar pins to the top
// of this element, so it's the boundary Floating UI must measure against. Falls
// back to <body> (a valid, always-connected boundary) when none is found, so the
// resolved value caches once instead of re-walking the tree on every compute.
function getScrollParent(node) {
	let el = node?.parentElement;
	while (el) {
		const overflowY = getComputedStyle(el).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') return el;
		el = el.parentElement;
	}
	return document.body;
}

// Resolve (and cache) the scroll ancestor lazily. The ProseMirror DOM isn't
// attached when this component mounts, so we resolve on first position compute
// (a selection, always post-mount) by which point it's in the tree.
let cachedBoundary = null;
function resolveScrollBoundary() {
	if (!cachedBoundary || !cachedBoundary.isConnected) {
		cachedBoundary = getScrollParent(props.editor?.view?.dom);
	}
	return cachedBoundary;
}

// This BubbleMenu is positioned by Floating UI (not tippy), so config goes through
// `options`, not `tippy-options`. By default flip measures against the viewport,
// which never sees the sticky toolbar — so a selection just under the toolbar
// places the menu on top of it and never flips. We pin the flip/shift boundary to
// the scroll container (whose top edge is the toolbar) and pad that top by the
// toolbar's height, so such a selection overflows upward and flips the menu below.
// flip/shift are Floating UI "derivable" options (functions) so the boundary is
// resolved at compute time, not at mount.
const floatingOptions = {
	strategy: 'fixed',
	placement: 'top',
	offset: 8,
	flip: () => ({
		fallbackPlacements: ['bottom'],
		padding: { top: TOOLBAR_HEIGHT, bottom: 8 },
		boundary: resolveScrollBoundary(),
	}),
	shift: () => ({ padding: 8, boundary: resolveScrollBoundary() }),
};

function shouldShowBubbleMenu({ editor, state }) {
	// On a phone the bubble menu (13 buttons) overflows the screen and fights the
	// OS text-selection toolbar. The sticky horizontally-scrolling toolbar plus
	// the slash menu cover every action, so we drop the bubble menu on mobile and
	// make those the primary paths (spec Phase 4 decision).
	if (isMobile.value) return false;

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
    /* Appended to <body>, so it must clear the editor chrome and sidebar. */
    z-index: 60;
}

.bubble-menu-buttons {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    background: var(--surface-base, #ffffff);
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
