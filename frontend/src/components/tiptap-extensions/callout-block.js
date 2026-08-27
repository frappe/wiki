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
