import { onBeforeUnmount, ref, toValue, watch } from 'vue';

// h2/h3 only, matching `_apply_heading_slugs_and_toc` in wiki/wiki/markdown.py.
// Keeping the two in step is what makes the editor rail a preview of the
// published page rather than a second, differently-shaped outline.
const TOC_LEVELS = [2, 3];

/**
 * Collect the heading entries of a ProseMirror doc, in document order.
 *
 * Entries carry the node's position rather than a slug: the editor scrolls by
 * resolving `pos` back to its DOM node, so the reader's slugify rules don't
 * need a JS twin.
 */
export function extractOutline(doc) {
	const headings = [];
	if (!doc?.descendants) return headings;

	doc.descendants((node, pos) => {
		// Descend through block containers (callouts, blockquotes, table cells can
		// all hold headings) but never into a paragraph's inline content.
		if (node.type?.name !== 'heading') return node.isBlock;
		const level = node.attrs?.level;
		const text = (node.textContent || '').trim();
		// A heading the author has only just opened has no text yet; it earns a
		// row once there's something to label it with.
		if (TOC_LEVELS.includes(level) && text) {
			headings.push({ level, text, pos });
		}
		return false;
	});

	return headings;
}

function sameOutline(a, b) {
	if (a.length !== b.length) return false;
	return a.every(
		(entry, i) =>
			entry.pos === b[i].pos &&
			entry.level === b[i].level &&
			entry.text === b[i].text,
	);
}

/**
 * Reactive heading outline of a TipTap editor, refreshed as the doc changes.
 */
export function useDocumentOutline(editor) {
	const outline = ref([]);
	let frame = null;
	let attached = null;

	function refresh() {
		frame = null;
		const next = extractOutline(attached?.state?.doc);
		// Typing body text changes the doc on every keystroke without touching a
		// single heading; bailing here keeps the rail from re-rendering for it.
		if (sameOutline(next, outline.value)) return;
		outline.value = next;
	}

	// Coalesce to the next frame: bursts of keystrokes each fire a transaction,
	// but the rail only needs to be right once per paint.
	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(refresh);
	}

	// `transaction` rather than `update`, because loading a page swaps content
	// via `setContent(..., { emitUpdate: false })` — an update-only listener
	// would show the previous page's outline until the first keystroke.
	function onTransaction({ transaction }) {
		if (transaction.docChanged) schedule();
	}

	function detach() {
		attached?.off('transaction', onTransaction);
		attached = null;
	}

	watch(
		() => toValue(editor),
		(instance) => {
			detach();
			attached = instance || null;
			if (!attached) {
				outline.value = [];
				return;
			}
			attached.on('transaction', onTransaction);
			refresh();
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		if (frame) cancelAnimationFrame(frame);
		detach();
	});

	return { outline };
}
