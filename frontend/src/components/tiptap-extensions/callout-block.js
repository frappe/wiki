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

/**
 * Callout types that are supported
 */
export const CALLOUT_TYPES = ['note', 'tip', 'caution', 'danger', 'warning'];

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
			hideTitle: {
				default: false,
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
					const hideTitle = !dom.querySelector('.callout-title');

					const contentEl = dom.querySelector('.callout-content');
					const content = contentEl ? contentEl.textContent : '';

					return { type, title, hideTitle, content };
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

		const children = [];
		if (!node.attrs.hideTitle) {
			children.push([
				'div',
				{ class: 'callout-title' },
				[
					'span',
					{},
					node.attrs.title ||
						node.attrs.type.charAt(0).toUpperCase() + node.attrs.type.slice(1),
				],
			]);
		}
		children.push(['div', { class: 'callout-content' }, node.attrs.content]);

		return ['aside', attrs, ...children];
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

	// TipTap v3 Markdown extension support
	markdownTokenizer: {
		name: 'calloutBlock',
		level: 'block',

		start(src) {
			return src.indexOf(':::');
		},

		tokenize(src, tokens, lexer) {
			// Match :::type[title]\ncontent\n::: or :::type\ncontent\n:::
			const match = /^:::(\w+)(\[([^\]]*)\])?\n([\s\S]*?)\n:::/.exec(src);

			if (!match) {
				return undefined;
			}

			const rawType = match[1].toLowerCase();
			if (!CALLOUT_TYPES.includes(rawType)) {
				return undefined;
			}

			// Normalize 'warning' to 'caution'
			const calloutType = rawType === 'warning' ? 'caution' : rawType;
			const hasBrackets = match[2] !== undefined;
			const bracketContent = match[3] || '';

			return {
				type: 'calloutBlock',
				raw: match[0],
				calloutType: calloutType,
				title: bracketContent,
				hideTitle: hasBrackets && bracketContent === '',
				text: (match[4] || '').trim(),
			};
		},
	},

	parseMarkdown(token) {
		return {
			type: 'calloutBlock',
			attrs: {
				type: token.calloutType || 'note',
				title: token.title || '',
				hideTitle: token.hideTitle || false,
				content: token.text || '',
			},
		};
	},

	renderMarkdown(node) {
		const calloutType = node.attrs.type || 'note';
		const title = node.attrs.title || '';
		const content = node.attrs.content || '';
		const hideTitle = node.attrs.hideTitle || false;

		if (hideTitle) {
			return `:::${calloutType}[]\n${content}\n:::\n\n`;
		}
		if (title) {
			return `:::${calloutType}[${title}]\n${content}\n:::\n\n`;
		}
		return `:::${calloutType}\n${content}\n:::\n\n`;
	},
});

export default CalloutBlock;
