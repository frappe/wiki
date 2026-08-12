/**
 * TipTap Callout Block Extension
 *
 * Custom node extension for Astro Starlight-style callout blocks.
 * Supports Markdown syntax: :::type[title]\ncontent\n:::
 *
 * Supported types: note, tip, caution, danger, warning
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

	atom: true,

	draggable: true,

	addAttributes() {
		return {
			type: {
				default: 'note',
			},
			title: {
				default: '',
			},
			content: {
				default: '',
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'aside.callout',
				getAttrs: (dom) => {
					const classList = dom.className.split(' ');
					const typeClass = classList.find((c) => c.startsWith('callout-'));
					const type = typeClass ? typeClass.replace('callout-', '') : 'note';

					const titleEl = dom.querySelector('.callout-title span');
					const title = titleEl ? titleEl.textContent : '';

					const contentEl = dom.querySelector('.callout-content');
					const content = contentEl ? contentEl.textContent : '';

					return { type, title, content };
				},
			},
			{
				tag: 'div[data-type="callout-block"]',
				getAttrs: (dom) => ({
					type: dom.getAttribute('data-callout-type') || 'note',
					title: dom.getAttribute('data-title') || '',
					content: dom.getAttribute('data-content') || '',
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
				{ class: 'callout-title' },
				[
					'span',
					{},
					node.attrs.title ||
						node.attrs.type.charAt(0).toUpperCase() + node.attrs.type.slice(1),
				],
			],
			['div', { class: 'callout-content' }, node.attrs.content],
		];
	},

	addNodeView() {
		return VueNodeViewRenderer(CalloutBlockView);
	},

	addCommands() {
		return {
			setCallout:
				(attributes) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: attributes,
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
