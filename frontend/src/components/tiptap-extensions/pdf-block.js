/**
 * TipTap PDF Block Extension
 *
 * Custom atom node that embeds an uploaded PDF as a preview card (first-page
 * thumbnail + filename + page count) which opens a full-screen viewer.
 *
 * Markdown syntax (image syntax disambiguated by the `.pdf` extension, mirroring
 * how video-block.js reuses image syntax for video URLs):
 *   ![filename.pdf](/files/document.pdf)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import PdfBlockView from './PdfBlockView.vue';

/**
 * Check if a URL points to a PDF based on its file extension.
 */
export function isPdfUrl(url) {
	if (!url) return false;
	const cleanUrl = String(url).split(/[?#]/)[0].toLowerCase();
	return cleanUrl.endsWith('.pdf');
}

export const PdfBlock = Node.create({
	name: 'pdfBlock',

	group: 'block',

	atom: true,

	draggable: true,

	addOptions() {
		return {
			HTMLAttributes: {},
		};
	},

	addAttributes() {
		return {
			src: {
				default: '',
			},
			filename: {
				default: '',
			},
			// Transient editor-only state for the upload lifecycle. `rendered: false`
			// keeps these out of serialized HTML, and renderMarkdown ignores them, so
			// they never persist to content (mirrors image-extension.js).
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
				tag: 'div[data-type="pdf-block"]',
				getAttrs: (dom) => ({
					src: dom.getAttribute('data-src') || '',
					filename: dom.getAttribute('data-filename') || '',
				}),
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
			'data-type': 'pdf-block',
			'data-src': node.attrs.src,
			'data-filename': node.attrs.filename || '',
		});

		return ['div', attrs];
	},

	addNodeView() {
		return VueNodeViewRenderer(PdfBlockView);
	},

	addCommands() {
		return {
			setPdf:
				(attributes) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: attributes,
					});
				},
			// Open a file picker and hand the chosen file to WikiEditor (which owns
			// the optimistic insert + upload flow), via a custom DOM event. Used by
			// both the toolbar button and the slash command.
			selectAndUploadPdf: () => () => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'application/pdf,.pdf';
				input.onchange = (event) => {
					const target = event.target;
					if (target?.files?.length) {
						document.dispatchEvent(
							new CustomEvent('wiki-editor-upload-pdf', {
								detail: { file: target.files[0] },
							}),
						);
					}
				};
				input.click();
				return true;
			},
		};
	},

	// TipTap v3 Markdown extension support — intercept image syntax with PDF URLs.
	markdownTokenizer: {
		name: 'pdfBlock',
		level: 'block',

		start(src) {
			return src.indexOf('![');
		},

		tokenize(src) {
			const match = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(src);

			if (!match) {
				return undefined;
			}

			const filename = match[1];
			const url = match[2];

			// Only tokenize when it's a PDF URL — otherwise let the image/video
			// tokenizers handle it.
			if (!isPdfUrl(url)) {
				return undefined;
			}

			return {
				type: 'pdfBlock',
				raw: match[0],
				filename,
				src: url,
			};
		},
	},

	parseMarkdown(token) {
		return {
			type: 'pdfBlock',
			attrs: {
				src: token.src || token.href || '',
				filename: token.filename || token.text || '',
			},
		};
	},

	renderMarkdown(node) {
		// Skip PDFs still uploading — their src is empty until the upload resolves;
		// once `loading` clears, the node re-serializes normally.
		if (node.attrs?.loading) {
			return '';
		}

		const src = node.attrs?.src || '';
		if (!src) {
			return '';
		}
		const filename = node.attrs?.filename || '';
		// No trailing "\n\n": the markdown serializer already inserts a blank-line
		// block separator between block nodes. Appending our own here doubles the
		// gap, and the PreserveBlankLines extension then re-parses the extra blanks
		// into empty paragraphs that add *another* separator on the next
		// serialize→parse cycle — so the gap between two consecutive embeds grows
		// without bound. That non-idempotent round-trip drives the editor's
		// content-reconcile loop forever and freezes the tab (see image-extension,
		// which is idempotent precisely because it omits the trailing newlines).
		return `![${filename}](${src})`;
	},
});

export default PdfBlock;
