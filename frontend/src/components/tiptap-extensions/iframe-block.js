/**
 * TipTap Iframe Block Extension
 *
 * Renders <iframe> embeds (YouTube, Vimeo, Loom, etc.) as live previews in
 * the editor and round-trips them as raw HTML blocks in markdown.
 *
 * Only src URLs from IFRAME_PROVIDERS are accepted. Unknown hosts are dropped
 * on parse so arbitrary iframes can't be smuggled into wiki pages.
 */

import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import IframeBlockView from './IframeBlockView.vue';
import {
	EMBED_HTML_PASTE_RE_G,
	EMBED_URL_PASTE_RE,
	escapeAttr,
	iframeAttrsFromHtml,
	isAllowedIframeSrc,
	normalizeEmbedUrl,
	parseIframeAttrs,
} from './iframe-embed.js';

// Pure embed-parsing helpers (providers, URL normalization, attr parsing) now
// live in ./iframe-embed.js so they can be unit-tested without this Vue/TipTap
// module. Re-export them for existing importers.
export {
	IFRAME_PROVIDERS,
	iframeAttrsFromHtml,
	isAllowedIframeSrc,
	matchProvider,
	normalizeEmbedUrl,
} from './iframe-embed.js';

export const IframeBlock = Node.create({
	name: 'iframeBlock',

	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			src: { default: '' },
			width: { default: null },
			height: { default: null },
			title: { default: null },
			allow: { default: null },
			allowfullscreen: { default: true },
			frameborder: { default: null },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'iframe',
				getAttrs: (dom) => {
					const src = dom.getAttribute('src') || '';
					if (!isAllowedIframeSrc(src)) return false;
					return {
						src,
						width: dom.getAttribute('width'),
						height: dom.getAttribute('height'),
						title: dom.getAttribute('title'),
						allow: dom.getAttribute('allow'),
						allowfullscreen: dom.hasAttribute('allowfullscreen'),
						frameborder: dom.getAttribute('frameborder'),
					};
				},
			},
			{
				tag: 'div[data-type="iframe-block"]',
				getAttrs: (dom) => {
					const src = dom.getAttribute('data-src') || '';
					if (!isAllowedIframeSrc(src)) return false;
					return {
						src,
						width: dom.getAttribute('data-width'),
						height: dom.getAttribute('data-height'),
						title: dom.getAttribute('data-title'),
						allow: dom.getAttribute('data-allow'),
						allowfullscreen:
							dom.getAttribute('data-allowfullscreen') !== 'false',
						frameborder: dom.getAttribute('data-frameborder'),
					};
				},
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		const iframeAttrs = {
			src: node.attrs.src,
			frameborder: node.attrs.frameborder || '0',
		};
		if (node.attrs.width) iframeAttrs.width = node.attrs.width;
		if (node.attrs.height) iframeAttrs.height = node.attrs.height;
		if (node.attrs.title) iframeAttrs.title = node.attrs.title;
		if (node.attrs.allow) iframeAttrs.allow = node.attrs.allow;
		if (node.attrs.allowfullscreen) iframeAttrs.allowfullscreen = '';

		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-type': 'iframe-block',
				'data-src': node.attrs.src,
				class: 'iframe-block',
			}),
			['iframe', iframeAttrs],
		];
	},

	addNodeView() {
		return VueNodeViewRenderer(IframeBlockView);
	},

	addPasteRules() {
		return [
			nodePasteRule({
				find: EMBED_URL_PASTE_RE,
				type: this.type,
				getAttributes: (match) => {
					const src = normalizeEmbedUrl(match[1]);
					if (!isAllowedIframeSrc(src)) return false;
					return { src };
				},
			}),
			nodePasteRule({
				find: EMBED_HTML_PASTE_RE_G,
				type: this.type,
				getAttributes: (match) => iframeAttrsFromHtml(match[0]) || false,
			}),
		];
	},

	addCommands() {
		return {
			setIframe:
				(attributes) =>
				({ commands }) => {
					const src = normalizeEmbedUrl(attributes?.src || '');
					if (!isAllowedIframeSrc(src)) return false;
					return commands.insertContent({
						type: this.name,
						attrs: { ...attributes, src },
					});
				},
			insertIframePlaceholder:
				() =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: { src: '' },
					});
				},
		};
	},

	// --- Markdown round-trip ---
	//
	// marked parses self-contained iframe HTML as an `html` block token. We
	// intercept matches whose src points to an allowlisted provider and upgrade
	// them to iframeBlock nodes. Unknown hosts return undefined, letting the
	// default html handler (which drops unknown nodes) take over.
	markdownTokenizer: {
		name: 'iframeBlock',
		level: 'block',

		start(src) {
			const idx = src.search(/<iframe\b/i);
			return idx < 0 ? undefined : idx;
		},

		tokenize(src) {
			const match = /^<iframe\b([^>]*)>\s*(?:<\/iframe>)?\s*/i.exec(src);
			if (!match) return undefined;

			const attrs = parseIframeAttrs(match[1]);
			if (!isAllowedIframeSrc(attrs.src)) return undefined;

			return {
				type: 'iframeBlock',
				raw: match[0],
				iframeAttrs: attrs,
			};
		},
	},

	parseMarkdown(token) {
		const a = token.iframeAttrs || {};
		return {
			type: 'iframeBlock',
			attrs: {
				src: a.src || '',
				width: a.width || null,
				height: a.height || null,
				title: a.title || null,
				allow: a.allow || null,
				allowfullscreen: 'allowfullscreen' in a,
				frameborder: a.frameborder || null,
			},
		};
	},

	renderMarkdown(node) {
		const attrs = node.attrs;
		const parts = [`src="${escapeAttr(attrs.src)}"`];
		if (attrs.width) parts.push(`width="${escapeAttr(attrs.width)}"`);
		if (attrs.height) parts.push(`height="${escapeAttr(attrs.height)}"`);
		if (attrs.title) parts.push(`title="${escapeAttr(attrs.title)}"`);
		if (attrs.allow) parts.push(`allow="${escapeAttr(attrs.allow)}"`);
		parts.push(`frameborder="${escapeAttr(attrs.frameborder || '0')}"`);
		if (attrs.allowfullscreen) parts.push('allowfullscreen');
		// No trailing "\n\n": the serializer already inserts a blank-line block
		// separator, and doubling it makes the markdown round-trip grow blank
		// lines without bound between consecutive embeds, which freezes the
		// editor in an infinite reconcile loop. See pdf-block.js for details.
		return `<iframe ${parts.join(' ')}></iframe>`;
	},
});

export default IframeBlock;
