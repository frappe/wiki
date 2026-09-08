<template>
	<!-- Held back until the scroll container is known: tiptap reads the floating
	     options once, when the menu mounts, so a menu that mounts first is stuck
	     listening to the window and never moves with the editor's own scroll. -->
	<EditorBubbleMenu
		v-if="editor && scrollBoundary"
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
import { computed, nextTick, onMounted, ref } from 'vue';

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

// Nearest scrollable ancestor of the editor: the page's one scroller (a
// ScrollArea viewport). The sticky toolbar pins to its top edge, so it is both
// the boundary Floating UI must measure against and the element whose scroll
// moves the selection under the menu. Falls back to <body>, which always
// scrolls with the document.
function getScrollParent(node) {
	let el = node?.parentElement;
	while (el) {
		const overflowY = getComputedStyle(el).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') return el;
		el = el.parentElement;
	}
	return document.body;
}

// The ProseMirror DOM is attached a tick after this component mounts, so the
// container is resolved there rather than in setup — and the menu itself waits
// for it (see the template).
const scrollBoundary = ref(null);
onMounted(async () => {
	await nextTick();
	scrollBoundary.value = getScrollParent(props.editor?.view?.dom);
});

function resolveScrollBoundary() {
	return scrollBoundary.value || document.body;
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
const floatingOptions = computed(() => ({
	strategy: 'fixed',
	placement: 'top',
	offset: 8,
	flip: () => ({
		fallbackPlacements: ['bottom'],
		padding: { top: TOOLBAR_HEIGHT, bottom: 8 },
		boundary: resolveScrollBoundary(),
	}),
	shift: () => ({ padding: 8, boundary: resolveScrollBoundary() }),
	// Without this the menu only repositions on window scroll, so scrolling the
	// editor leaves it parked mid-page looking like a second toolbar.
	scrollTarget: scrollBoundary.value,
	// And once the selection scrolls out of the container the menu goes with it
	// instead of hovering over unrelated text.
	//
	// The boundary is the container alone, with no toolbar padding: Floating
	// UI's `hide` reports a reference as hidden when it overflows on *any*
	// side, so padding the top by the toolbar's height hid the menu for a
	// selection merely tucked under the toolbar — which is the case `flip`
	// exists to handle by putting the menu below it.
	hide: () => ({ boundary: resolveScrollBoundary() }),
	shouldShow: shouldShowBubbleMenu,
}));
</script>

<style scoped>
.wiki-bubble-menu {
    /* tiptap appends the menu to the editor's own parent — the prose column —
       not to <body>, so it must clear the editor chrome and the sidebar. */
    z-index: 60;

    /* Load-bearing, `!important` included — it is beating an inline style.
       On mount tiptap writes `el.style.position = "absolute"`, and only after
       positioning does it write back the strategy we asked for. Floating UI
       picks the box its coordinates are relative to by reading the floating
       element's computed position: anything but `fixed` and it measures
       against the nearest positioned ancestor. So the first computePosition
       answered in coordinates relative to the prose column's `relative`
       wrapper, tiptap then stamped `position: fixed` on top of that answer,
       and the menu landed up and to the left of the selection by exactly that
       wrapper's origin. Every later selection was correct, because by then
       the element was already fixed — which is why this only ever showed up
       on the first selection after opening a page. */
    position: fixed !important;
}
</style>
