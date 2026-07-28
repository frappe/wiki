<template>
	<EditorBubbleMenu
		v-if="editor"
		class="wiki-bubble-menu"
		:editor="editor"
		:items="bubbleItems"
		:options="floatingOptions"
	/>
</template>

<script setup>
import { useMobile } from '@/composables/useMobile';
import { NodeSelection } from '@tiptap/pm/state';
import {
	Blockquote,
	Bold,
	BulletList,
	EditorBubbleMenu,
	H1,
	H2,
	H3,
	InlineCode,
	InsertLink,
	Italic,
	OrderedList,
	Separator,
	Strike,
} from 'frappe-ui/editor';

const props = defineProps({
	editor: {
		type: Object,
		required: true,
	},
});

const { isMobile } = useMobile();

const CodeBlockItem = {
	icon: 'lucide-square-code',
	label: 'Code Block',
	action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
	isActive: (editor) => editor.isActive('codeBlock'),
};

const bubbleItems = [
	Bold,
	Italic,
	Strike,
	InlineCode,
	Separator,
	InsertLink,
	Separator,
	H1,
	H2,
	H3,
	Separator,
	BulletList,
	OrderedList,
	Separator,
	Blockquote,
	CodeBlockItem,
];

// Sticky toolbar height (WikiToolbar measures ~49px); pad a little above it so the
// flip boundary clears the toolbar band with room to spare.
const TOOLBAR_HEIGHT = 56;

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

function shouldShowBubbleMenu({ editor, state }) {
	// On a phone the bubble menu overflows the screen and fights the OS
	// text-selection toolbar. The sticky horizontally-scrolling toolbar plus
	// the slash menu cover every action, so we drop the bubble menu on mobile
	// and make those the primary paths (spec Phase 4 decision).
	if (isMobile.value) return false;

	const selection = state.selection;

	// Bubble menu is only for inline text formatting, not media/node selections.
	if (selection instanceof NodeSelection) return false;
	if (selection.empty) return false;
	if (editor.isActive('videoBlock')) return false;
	if (editor.isActive('image')) return false;

	return true;
}

// EditorBubbleMenu is positioned by Floating UI, so config goes through
// `options`. By default flip measures against the viewport, which never sees
// the sticky toolbar — so a selection just under the toolbar places the menu
// on top of it and never flips. We pin the flip/shift boundary to the scroll
// container (whose top edge is the toolbar) and pad that top by the toolbar's
// height, so such a selection overflows upward and flips the menu below.
// flip/shift are Floating UI "derivable" options (functions) so the boundary
// is resolved at compute time, not at mount.
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
	shouldShow: shouldShowBubbleMenu,
};
</script>

<style scoped>
.wiki-bubble-menu {
    /* Appended to <body>, so it must clear the editor chrome and sidebar. */
    z-index: 60;
}
</style>
