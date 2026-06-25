/**
 * TipTap Mermaid Block Extension
 *
 * Renders Mermaid fenced code blocks as editable diagram preview blocks.
 * Markdown syntax: ```mermaid\nflowchart TD\n  A --> B\n```
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import MermaidBlockView from './MermaidBlockView.vue';
import { parseMermaidFence, renderMermaidFence } from './mermaid-markdown.js';

export const DEFAULT_MERMAID_CODE = 'flowchart TD\n  A[Start] --> B[End]';

export const MermaidBlock = Node.create({
	name: 'mermaidBlock',

	group: 'block',

	atom: true,

	draggable: true,

	addAttributes() {
		return {
			code: {
				default: DEFAULT_MERMAID_CODE,
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'pre.mermaid',
				getAttrs: (dom) => ({
					code: dom.textContent || '',
				}),
			},
			{
				tag: 'div[data-type="mermaid-block"]',
				getAttrs: (dom) => ({
					code: dom.getAttribute('data-code') || '',
				}),
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			'pre',
			mergeAttributes(HTMLAttributes, {
				class: 'mermaid',
				'data-type': 'mermaid-block',
			}),
			node.attrs.code || '',
		];
	},

	addNodeView() {
		return VueNodeViewRenderer(MermaidBlockView);
	},

	addCommands() {
		return {
			setMermaid:
				(attributes) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: {
							code: attributes?.code || DEFAULT_MERMAID_CODE,
						},
					});
				},
		};
	},

	markdownTokenizer: {
		name: 'mermaidBlock',
		level: 'block',

		start(src) {
			const backtickIndex = src.indexOf('```mermaid');
			const tildeIndex = src.indexOf('~~~mermaid');
			if (backtickIndex < 0) return tildeIndex < 0 ? undefined : tildeIndex;
			if (tildeIndex < 0) return backtickIndex;
			return Math.min(backtickIndex, tildeIndex);
		},

		tokenize(src) {
			const parsed = parseMermaidFence(src);
			if (!parsed) return undefined;

			return {
				type: 'mermaidBlock',
				raw: parsed.raw,
				code: parsed.code,
			};
		},
	},

	parseMarkdown(token) {
		return {
			type: 'mermaidBlock',
			attrs: {
				code: token.code || '',
			},
		};
	},

	renderMarkdown(node) {
		return renderMermaidFence(node.attrs.code);
	},
});

export default MermaidBlock;
