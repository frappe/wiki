/**
 * Pure embed-parsing helpers for the iframe block.
 *
 * Split out from iframe-block.js so this logic stays free of the TipTap node
 * and its Vue NodeView — keeping it importable from plain unit tests and
 * breaking the iframe-block.js ⇄ IframeBlockView.vue import cycle.
 *
 * Only src URLs from IFRAME_PROVIDERS are accepted. Unknown hosts are dropped
 * so arbitrary iframes can't be smuggled into wiki pages.
 */

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

const EMBED_HOSTS_RE = IFRAME_PROVIDERS.flatMap((p) => p.hosts)
	.map((h) => h.replace(/\./g, '\\.'))
	.join('|');

/**
 * Regex matching a paste whose *entire content* is a URL on an allowlisted
 * host. Anchored to the full text so pasting a URL inline inside a sentence
 * doesn't trigger replacement — only paste-alone embeds.
 *
 * TipTap's paste-rule engine feeds each `find` to String.prototype.matchAll(),
 * which throws on a non-global RegExp — so paste-rule patterns MUST be global.
 */
export const EMBED_URL_PASTE_RE = new RegExp(
	`^\\s*(https?://(?:[\\w-]+\\.)*(?:${EMBED_HOSTS_RE})/\\S+)\\s*$`,
	'g',
);

// Non-global form drives the stateless .exec() in iframeAttrsFromHtml (a global
// regex would carry lastIndex across calls); EMBED_HTML_PASTE_RE_G is its global
// twin for the paste rule, which goes through matchAll.
export const EMBED_HTML_PASTE_RE =
	/^\s*<iframe\b([^>]*)>\s*(?:<\/iframe>)?\s*$/i;
export const EMBED_HTML_PASTE_RE_G = new RegExp(
	EMBED_HTML_PASTE_RE.source,
	`${EMBED_HTML_PASTE_RE.flags}g`,
);

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

export function parseIframeAttrs(attrString) {
	const attrs = {};
	const re =
		/([a-zA-Z_:][\w:.\-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
	for (const m of attrString.matchAll(re)) {
		attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
	}
	return attrs;
}

export function escapeAttr(value) {
	return String(value).replace(/"/g, '&quot;');
}
