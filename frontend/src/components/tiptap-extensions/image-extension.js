import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ImageNodeView from './ImageNodeView.vue';
import {
	imageCaptionTokenizer,
	renderImageMarkdown,
} from './image-markdown.js';

// Markdown image regex: ![alt](src "title")
// The src allows spaces and one level of balanced parens so Frappe filenames
// like `/files/CleanShot 2026-05-27 at 00.06.09@2x.png` or `/files/image (24).png`
// round-trip correctly. The src group is non-greedy so the optional title
// (quoted, whitespace-separated) is still split off rather than swallowed.
const inputRegex =
	/(?:^|\s)(!\[([^\]]*)]\(((?:[^()"]|\([^()"]*\))+?)(?:\s+["']([^"']+)["'])?\))$/;

/**
 * Custom Image extension with caption support
 *
 * Captions use the Stack Overflow pattern in markdown:
 *   ![alt text](image.jpg)
 *   *caption text*
 *
 * - alt: For accessibility (screen readers)
 * - caption: Visible caption text below the image
 * - darkSrc, width, align: saved on a `<picture>` block when any is set
 */

export const WikiImage = Node.create({
	name: 'image',

	group: 'block',

	draggable: true,

	addOptions() {
		return {
			inline: false,
			allowBase64: true,
			HTMLAttributes: {},
			uploadImage: null,
		};
	},

	addAttributes() {
		return {
			src: {
				default: null,
			},
			alt: {
				default: null,
			},
			title: {
				default: null,
			},
			caption: {
				default: null,
			},
			darkSrc: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-dark-src'),
				renderHTML: (attributes) =>
					attributes.darkSrc ? { 'data-dark-src': attributes.darkSrc } : {},
			},
			width: {
				default: null,
			},
			align: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-align'),
				renderHTML: (attributes) =>
					attributes.align ? { 'data-align': attributes.align } : {},
			},
			height: {
				default: null,
			},
			// Transient editor-only state for the upload/optimization lifecycle.
			// `rendered: false` keeps these out of the serialized HTML, and
			// renderMarkdown ignores them, so they never persist to content.
			loading: {
				default: false,
				rendered: false,
			},
			uploadId: {
				default: null,
				rendered: false,
			},
			error: {
				default: null,
				rendered: false,
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'img[src]',
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'img',
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
		];
	},

	// Custom tokenizer for marked.js to capture image + caption pattern
	markdownTokenizer: imageCaptionTokenizer,

	// Token name must match the tokenizer's type
	markdownTokenName: 'wikiImage',

	// Parse markdown image with optional caption
	parseMarkdown: (token, helpers) => {
		return helpers.createNode('image', {
			src: token.href,
			darkSrc: token.darkSrc || null,
			title: token.title,
			alt: token.text,
			caption: token.caption || null,
			width: token.width || null,
			align: token.align || null,
		});
	},

	renderMarkdown: renderImageMarkdown,

	addNodeView() {
		return VueNodeViewRenderer(ImageNodeView);
	},

	addCommands() {
		return {
			setImage:
				(options) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: options,
					});
				},
		};
	},

	addInputRules() {
		return [
			nodeInputRule({
				find: inputRegex,
				type: this.type,
				getAttributes: (match) => {
					const [, , alt, src, title] = match;
					return { src, alt, title };
				},
			}),
		];
	},
});

export default WikiImage;
