/**
 * TipTap Video Block Extension
 *
 * Custom node extension for video blocks.
 * Renders video URLs (like GitHub does) as HTML5 video players.
 *
 * Markdown syntax: ![title](video-url.mp4)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import VideoBlockView from './VideoBlockView.vue';

/**
 * Video extensions that should be rendered as video players
 */
export const VIDEO_EXTENSIONS = [
	'.mp4',
	'.webm',
	'.ogg',
	'.mov',
	'.avi',
	'.mkv',
	'.m4v',
];

/**
 * Check if a URL is a video URL based on file extension
 */
export function isVideoUrl(url) {
	if (!url) return false;
	const cleanUrl = String(url).split(/[?#]/)[0].toLowerCase();
	return VIDEO_EXTENSIONS.some((ext) => cleanUrl.endsWith(ext));
}

export const VideoBlock = Node.create({
	name: 'videoBlock',

	group: 'block',

	atom: true,

	draggable: true,

	addOptions() {
		return {
			uploadFunction: null,
			HTMLAttributes: {},
		};
	},

	addAttributes() {
		return {
			src: {
				default: '',
			},
			alt: {
				default: '',
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-type="video-block"]',
				getAttrs: (dom) => ({
					src: dom.getAttribute('data-src') || '',
					alt: dom.getAttribute('data-alt') || '',
				}),
			},
			{
				tag: 'video',
				getAttrs: (dom) => ({
					src:
						dom.getAttribute('src') ||
						dom.querySelector('source')?.getAttribute('src') ||
						'',
					alt: dom.getAttribute('title') || '',
				}),
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
			'data-type': 'video-block',
			'data-src': node.attrs.src,
			'data-alt': node.attrs.alt,
		});

		return [
			'div',
			attrs,
			[
				'video',
				{
					src: node.attrs.src,
					controls: true,
					preload: 'metadata',
					style: 'max-width: 100%; border-radius: 8px;',
				},
				['source', { src: node.attrs.src }],
			],
		];
	},

	addNodeView() {
		return VueNodeViewRenderer(VideoBlockView);
	},

	addCommands() {
		return {
			setVideo:
				(attributes) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: attributes,
					});
				},
			uploadVideo:
				(file) =>
				({ editor }) => {
					const pos = editor.state.selection.from;
					return uploadVideoInternal(file, editor.view, pos, this.options);
				},
			selectAndUploadVideo:
				() =>
				({ editor }) => {
					if (!this.options.uploadFunction) {
						console.error('uploadFunction option is not provided for videos.');
						return false;
					}

					const input = document.createElement('input');
					input.type = 'file';
					input.accept = 'video/*';
					input.onchange = (event) => {
						const target = event.target;
						if (target?.files?.length) {
							const file = target.files[0];
							editor.commands.uploadVideo(file);
						}
					};
					input.click();
					return true;
				},
		};
	},

	// TipTap v3 Markdown extension support
	// Custom tokenizer to intercept image syntax with video URLs
	markdownTokenizer: {
		name: 'videoBlock',
		level: 'block',

		start(src) {
			// Look for image-like syntax that could be a video
			return src.indexOf('![');
		},

		tokenize(src) {
			// Match markdown image syntax: ![alt](url)
			const match = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(src);

			if (!match) {
				return undefined;
			}

			const alt = match[1];
			const url = match[2];

			// Only tokenize if it's a video URL
			if (!isVideoUrl(url)) {
				return undefined;
			}

			return {
				type: 'videoBlock',
				raw: match[0],
				alt: alt,
				src: url,
			};
		},
	},

	parseMarkdown(token) {
		return {
			type: 'videoBlock',
			attrs: {
				src: token.src || token.href || '',
				alt: token.alt || token.text || '',
			},
		};
	},

	renderMarkdown(node) {
		const alt = node.attrs.alt || '';
		const src = node.attrs.src || '';
		return `![${alt}](${src})\n\n`;
	},
});

export default VideoBlock;

function uploadVideoInternal(file, view, pos, options) {
	if (!options?.uploadFunction) {
		console.error('uploadFunction option is not provided for videos.');
		return false;
	}

	options
		.uploadFunction(file)
		.then((uploadedVideo) => {
			const url =
				typeof uploadedVideo === 'string'
					? uploadedVideo
					: uploadedVideo?.file_url;
			if (!url) {
				console.error('Video upload returned no URL.');
				return;
			}
			const { schema } = view.state;
			const node = schema.nodes.videoBlock.create({ src: url });

			const transaction = view.state.tr;
			if (pos != null) {
				transaction.insert(pos, node);
			} else {
				transaction.replaceSelectionWith(node);
			}
			view.dispatch(transaction);
		})
		.catch((error) => {
			console.error('Video upload failed:', error);
		});

	return true;
}
