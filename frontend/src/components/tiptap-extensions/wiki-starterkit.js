import { StarterKit } from '@tiptap/starter-kit';

/**
 * Shared StarterKit configuration for the wiki editor (WikiEditor.vue) and the
 * read-only renderer (WikiContentViewer.vue), so the two never drift apart.
 *
 * Disabled marks/nodes:
 * - codeBlock: replaced by frappe-ui's CodeBlock (lowlight highlighting,
 *   line numbers, language picker, copy button, Tab indent keymaps).
 * - link: replaced by WikiLink (Cmd+K editor, markdown round-trip).
 * - underline: replaced by WikiUnderline. StarterKit's Underline mark
 *   serializes to `++…++`, which markdown-it does not render, and it underlines
 *   every pasted link, corrupting it into `++[text](url)++`. See issue #667.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.paragraph=true] Pass false to disable StarterKit's
 *   paragraph node (WikiEditor swaps in WikiParagraph for blank-line support).
 */
export function wikiStarterKit({ paragraph = true } = {}) {
	return StarterKit.configure({
		codeBlock: false,
		link: false,
		underline: false,
		...(paragraph ? {} : { paragraph: false }),
	});
}
