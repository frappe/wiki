import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ImageNodeView from './ImageNodeView.vue';
import { isPdfUrl } from './pdf-block.js';
import { isVideoUrl } from './video-block.js';

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
 */

/**
 * Custom marked tokenizer that matches image followed by caption on next line.
 * Pattern: ![alt](src "title")\n*caption*
 */
const imageCaptionTokenizer = {
	name: 'wikiImage',
	level: 'block',

	start(src) {
		return src.indexOf('![');
	},

	tokenize(src, tokens, lexer) {
		// Match: ![alt](src) or ![alt](src "title") optionally followed by \n*caption*
		// The URL allows spaces and one level of balanced parens so Frappe
		// filenames like `/files/CleanShot 2026-05-27 at 00.06.09@2x.png` or
		// `/files/image (24).png` survive (otherwise spaces / inner `)` break it).
		// The URL group is non-greedy so a trailing quoted title is still split
		// off instead of being absorbed into the src.
		const imagePattern =
			/^!\[([^\]]*)\]\(((?:[^()"]|\([^()"]*\))+?)(?:\s+"([^"]*)")?\)/;
		const captionPattern = /^\n\*([^*]+)\*/;

		const imageMatch = imagePattern.exec(src);
		if (!imageMatch) {
			return undefined;
		}

		const [imageRaw, alt, hrefRaw, title] = imageMatch;
		const href = (hrefRaw || '').trim();
		if (isVideoUrl(href) || isPdfUrl(href)) {
			return undefined;
		}
		let caption = null;
		let raw = imageRaw;

		// Check for caption on next line
		const remaining = src.slice(imageRaw.length);
		const captionMatch = captionPattern.exec(remaining);
		if (captionMatch) {
			caption = captionMatch[1];
			raw += captionMatch[0];
		}

		return {
			type: 'wikiImage',
			raw,
			text: alt || '',
			href: href || '',
			title: title || null,
			caption: caption,
		};
	},
};

export const WikiImage = Node.create({
	name: 'image',

	group: 'block',

	draggable: true,

	addOptions() {
		return {
			inline: false,
			allowBase64: true,
			HTMLAttributes: {},
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
			width: {
				default: null,
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
			title: token.title,
			alt: token.text,
			caption: token.caption || null,
		});
	},

	// Render to markdown using Stack Overflow caption pattern:
	// ![alt](src "title")
	// *caption*
	renderMarkdown: (node) => {
		// Skip images still uploading/optimizing — their `src` is a transient
		// base64 preview that must never be written to saved content. Once the
		// upload resolves, `loading` clears and the node re-serializes normally.
		if (node.attrs?.loading) {
			return '';
		}

		const src = node.attrs?.src ?? '';
		const alt = node.attrs?.alt ?? '';
		const title = node.attrs?.title ?? '';
		const caption = node.attrs?.caption ?? '';

		let md = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;

		// Add caption on next line (no blank line) if present
		if (caption) {
			md += `\n*${caption}*`;
		}

		return md;
	},

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
