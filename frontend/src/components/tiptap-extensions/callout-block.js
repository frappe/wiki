/**
 * TipTap Callout Block Extension
 *
 * Custom node extension for Astro Starlight-style callout blocks.
 * Supports Markdown syntax: :::type[title]\ncontent\n:::
 *
 * Supported types: note, tip, caution, danger, warning
 *
 * The body is real document content (`content: 'block+'`), not an attribute, so
 * every mark and block node the editor has works inside a callout without the
 * node view owning an editor of its own.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CalloutBlockView from './CalloutBlockView.vue';
import {
	CALLOUT_TYPES,
	calloutMarkdownTokenizer,
	parseCalloutMarkdown,
	renderCalloutMarkdown,
} from './callout-markdown.js';

export { CALLOUT_TYPES };

/**
 * Default titles for each callout type
 */
export const DEFAULT_TITLES = {
	note: 'Note',
	tip: 'Tip',
	caution: 'Caution',
	danger: 'Danger',
	warning: 'Caution',
};

/**
 * Depth of the callout the position sits in, or null when it sits outside one.
 */
function calloutDepth($pos, name) {
	for (let depth = $pos.depth; depth > 0; depth--) {
		if ($pos.node(depth).type.name === name) {
			return depth;
		}
	}
	return null;
}

export const CalloutBlock = Node.create({
	name: 'calloutBlock',

	group: 'block',

	content: 'block+',

	// A callout is a unit: a paste replaces its body rather than splitting it,
	// and Backspace/Delete at either edge can't join it with its neighbours.
	defining: true,

	isolating: true,

	draggable: true,

	addAttributes() {
		return {
			type: {
				default: 'note',
			},
			title: {
				default: '',
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'aside.callout',
				contentElement: '.callout-content',
				getAttrs: (dom) => {
					const classList = dom.className.split(' ');
					const typeClass = classList.find((c) => c.startsWith('callout-'));
					const type = typeClass ? typeClass.replace('callout-', '') : 'note';

					const titleEl = dom.querySelector('.callout-title');
					const title = titleEl ? titleEl.textContent.trim() : '';

					return { type, title };
				},
			},
			{
				tag: 'div[data-type="callout-block"]',
				contentElement: '.callout-content',
				getAttrs: (dom) => ({
					type: dom.getAttribute('data-callout-type') || 'note',
					title: dom.getAttribute('data-title') || '',
				}),
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		const attrs = mergeAttributes(HTMLAttributes, {
			class: `callout callout-${node.attrs.type}`,
			'data-type': 'callout-block',
			'data-callout-type': node.attrs.type,
		});

		return [
			'aside',
			attrs,
			[
				'div',
				{ class: 'callout-header' },
				[
					'span',
					{ class: 'callout-title' },
					node.attrs.title ||
						node.attrs.type.charAt(0).toUpperCase() + node.attrs.type.slice(1),
				],
			],
			['div', { class: 'callout-content' }, 0],
		];
	},

	addNodeView() {
		return VueNodeViewRenderer(CalloutBlockView);
	},

	addKeyboardShortcuts() {
		// A callout is `isolating`, so ProseMirror's own exits don't apply: at the
		// end of the document there is nothing after the node to move into, and
		// the cursor would have nowhere to go.
		const exitForward = () => {
			const { $from, empty } = this.editor.state.selection;
			if (!empty) return false;

			const depth = calloutDepth($from, this.name);
			if (depth === null) return false;

			const after = $from.after(depth);
			return this.editor
				.chain()
				.insertContentAt(after, { type: 'paragraph' })
				.setTextSelection(after + 1)
				.focus()
				.run();
		};

		return {
			'Mod-Enter': exitForward,

			ArrowDown: () => {
				const { state } = this.editor;
				const { $from, empty } = state.selection;
				if (!empty) return false;

				const depth = calloutDepth($from, this.name);
				if (depth === null) return false;

				// Only when the callout ends the document and the cursor is at the
				// end of its last block — anything else has somewhere to go already.
				if ($from.after(depth) < state.doc.content.size) return false;
				if ($from.pos < $from.end(depth) - 1) return false;

				return exitForward();
			},

			Backspace: () => {
				const { $from, empty } = this.editor.state.selection;
				if (!empty) return false;

				const depth = calloutDepth($from, this.name);
				if (depth === null) return false;

				// Only at the very start of the first block, and only when there is
				// nothing left to delete inside — otherwise fall through to the
				// default, which `isolating` already stops at the border.
				if ($from.pos !== $from.start(depth) + 1) return false;

				const callout = $from.node(depth);
				if (callout.childCount > 1 || callout.firstChild?.content.size) {
					return false;
				}

				const from = $from.before(depth);
				return this.editor.commands.deleteRange({
					from,
					to: from + callout.nodeSize,
				});
			},
		};
	},

	addCommands() {
		return {
			setCallout:
				(attributes) =>
				({ commands, editor }) => {
					// The `:::` fence can't express a callout inside a callout, so
					// don't offer one.
					if (editor.isActive(this.name)) {
						return false;
					}

					return commands.insertContent({
						type: this.name,
						attrs: attributes,
						content: [{ type: 'paragraph' }],
					});
				},
		};
	},

	// TipTap v3 Markdown extension support. The hooks live in callout-markdown.js
	// so they can be unit tested without loading this module's .vue node view.
	markdownTokenizer: calloutMarkdownTokenizer,

	parseMarkdown: parseCalloutMarkdown,

	renderMarkdown: renderCalloutMarkdown,
});

export default CalloutBlock;
