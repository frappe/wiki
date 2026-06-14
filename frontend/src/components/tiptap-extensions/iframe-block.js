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

export const IFRAME_PROVIDERS = [
	{
		name: 'youtube',
		hosts: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
	},
	{ name: 'vimeo', hosts: ['vimeo.com', 'player.vimeo.com'] },
	{ name: 'loom', hosts: ['loom.com'] },
	{ name: 'codepen', hosts: ['codepen.io'] },
	{ name: 'codesandbox', hosts: ['codesandbox.io'] },
	{ name: 'figma', hosts: ['figma.com'] },
	{ name: 'framer', hosts: ['framer.com'] },
	{ name: 'miro', hosts: ['miro.com'] },
	{ name: 'google', hosts: ['docs.google.com', 'drive.google.com'] },
	{
		name: 'cloudflare-stream',
		hosts: ['cloudflarestream.com', 'videodelivery.net'],
	},
	{
		name: 'bunny-stream',
		hosts: ['mediadelivery.net', 'bunnycdn.com'],
	},
	{ name: 'aparat', hosts: ['aparat.com'] },
	{ name: 'github-gist', hosts: ['gist.github.com'] },
];

function hostOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

export function matchProvider(url) {
	const host = hostOf(url);
	if (!host) return null;
	for (const provider of IFRAME_PROVIDERS) {
		if (provider.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
			return provider.name;
		}
	}
	return null;
}

export function isAllowedIframeSrc(url) {
	return matchProvider(url) !== null;
}

/**
 * Convert user-friendly URLs (watch pages, share links) into the provider's
 * embed URL. Pasting a plain youtube.com/watch?v=X should Just Work.
 */
export function normalizeEmbedUrl(url) {
	if (!url) return '';
	const input = String(url).trim();
	let u;
	try {
		u = new URL(input);
	} catch {
		return input;
	}
	const host = u.hostname.toLowerCase().replace(/^www\./, '');

	if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
		if (u.pathname === '/watch' && u.searchParams.get('v')) {
			return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
		}
		if (u.pathname.startsWith('/shorts/')) {
			return `https://www.youtube.com/embed/${u.pathname.slice(
				'/shorts/'.length,
			)}`;
		}
		return input;
	}
	if (host === 'youtu.be') {
		const id = u.pathname.slice(1);
		return id ? `https://www.youtube.com/embed/${id}` : input;
	}
	if (host === 'vimeo.com') {
		const id = u.pathname.match(/^\/(\d+)/)?.[1];
		if (id) return `https://player.vimeo.com/video/${id}`;
	}
	if (host === 'loom.com' && u.pathname.startsWith('/share/')) {
		return `https://www.loom.com/embed/${u.pathname.slice('/share/'.length)}`;
	}

	// Google Drive: /file/d/<id>/view[?…] → /file/d/<id>/preview
	if (host === 'drive.google.com') {
		const id = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1];
		if (id) return `https://drive.google.com/file/d/${id}/preview`;
	}

	// Google Docs / Sheets / Slides: /<kind>/d/<id>/edit|pub → /preview or /embed
	if (host === 'docs.google.com') {
		const m = u.pathname.match(
			/^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)(\/(edit|pub|view))?/,
		);
		if (m) {
			const kind = m[1];
			const id = m[2];
			const action = kind === 'presentation' ? 'embed' : 'preview';
			return `https://docs.google.com/${kind}/d/${id}/${action}`;
		}
	}

	// Cloudflare Stream: customer-*.cloudflarestream.com/<uid>/watch
	if (host.endsWith('.cloudflarestream.com')) {
		const id = u.pathname.match(/^\/([a-f0-9]{32})\/watch$/)?.[1];
		if (id) return `https://iframe.videodelivery.net/${id}`;
	}

	// Bunny Stream share URLs → player.mediadelivery.net/embed
	if (
		host === 'iframe.mediadelivery.net' ||
		host === 'video.bunnycdn.com' ||
		host === 'player.mediadelivery.net'
	) {
		const match = u.pathname.match(/^\/play\/([A-Za-z0-9]+\/[A-Za-z0-9-]+)$/);
		if (match) return `https://player.mediadelivery.net/embed/${match[1]}`;
	}

	// Aparat: /v/<hash> → /video/video/embed/videohash/<hash>/vt/frame
	if (host === 'aparat.com') {
		const id = u.pathname.match(/^\/v\/([^/?&]+)\/?$/)?.[1];
		if (id) {
			return `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame`;
		}
	}

	return input;
}

/**
 * Regex matching a paste whose *entire content* is a URL on an allowlisted
 * host. Anchored to the full text so pasting a URL inline inside a sentence
 * doesn't trigger replacement — only paste-alone embeds.
 */
const EMBED_HOSTS_RE = IFRAME_PROVIDERS.flatMap((p) => p.hosts)
	.map((h) => h.replace(/\./g, '\\.'))
	.join('|');
const EMBED_URL_PASTE_RE = new RegExp(
	`^\\s*(https?://(?:[\\w-]+\\.)*(?:${EMBED_HOSTS_RE})/\\S+)\\s*$`,
);
const EMBED_HTML_PASTE_RE = /^\s*<iframe\b([^>]*)>\s*(?:<\/iframe>)?\s*$/i;

/**
 * Parse a raw <iframe …> tag string into the attrs shape iframeBlock stores.
 * Returns null if the src isn't on the allowlist.
 */
export function iframeAttrsFromHtml(html) {
	const match = EMBED_HTML_PASTE_RE.exec(html);
	if (!match) return null;
	const parsed = parseIframeAttrs(match[1]);
	if (!isAllowedIframeSrc(parsed.src)) return null;
	return {
		src: parsed.src,
		width: parsed.width || null,
		height: parsed.height || null,
		title: parsed.title || null,
		allow: parsed.allow || null,
		allowfullscreen: 'allowfullscreen' in parsed,
		frameborder: parsed.frameborder || null,
	};
}

function parseIframeAttrs(attrString) {
	const attrs = {};
	const re =
		/([a-zA-Z_:][\w:.\-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
	for (const m of attrString.matchAll(re)) {
		attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
	}
	return attrs;
}

function escapeAttr(value) {
	return String(value).replace(/"/g, '&quot;');
}

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
				find: EMBED_HTML_PASTE_RE,
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
