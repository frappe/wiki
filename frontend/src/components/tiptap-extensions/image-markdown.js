/**
 * Markdown tokenizer and serializer for the image node.
 *
 * Split out of image-extension.js so it can be unit tested: that module
 * imports a .vue node view at the top level, which `node --test` cannot load.
 */
import { isPdfUrl, isVideoUrl } from './media-urls.js';

// The URL allows spaces and one level of balanced parens so Frappe filenames
// like `/files/CleanShot 2026-05-27 at 00.06.09@2x.png` or
// `/files/image (24).png` survive (otherwise spaces / inner `)` break it).
// The URL group is non-greedy so a trailing quoted title is still split off
// instead of being absorbed into the src.
const IMAGE_PATTERN =
	/^!\[([^\]]*)\]\(((?:[^()"]|\([^()"]*\))+?)(?:\s+"([^"]*)")?\)/;
const PICTURE_PATTERN = /^<picture>\s*([\s\S]*?)\s*<\/picture>/;
const CAPTION_PATTERN = /^\n\*([^*]+)\*/;
const DARK_MEDIA = '(prefers-color-scheme: dark)';

/**
 * Custom marked tokenizer for an image followed by an optional caption line.
 *
 *   ![alt](src "title")
 *   *caption*
 *
 * or, when the image has a dark mode version (GitBook's Git Sync format):
 *
 *   <picture>
 *     <source srcset="dark.png" media="(prefers-color-scheme: dark)">
 *     <img src="light.png" alt="alt">
 *   </picture>
 *   *caption*
 */
export const imageCaptionTokenizer = {
	name: 'wikiImage',
	level: 'block',

	start(src) {
		const indexes = [src.indexOf('!['), src.indexOf('<picture>')].filter(
			(index) => index !== -1,
		);
		return indexes.length ? Math.min(...indexes) : -1;
	},

	tokenize(src) {
		const image = matchPicture(src) ?? matchImage(src);
		if (!image) return undefined;

		const captionMatch = CAPTION_PATTERN.exec(src.slice(image.raw.length));
		return {
			type: 'wikiImage',
			...image,
			raw: image.raw + (captionMatch?.[0] ?? ''),
			caption: captionMatch?.[1] ?? null,
		};
	},
};

function matchImage(src) {
	const match = IMAGE_PATTERN.exec(src);
	if (!match) return null;

	const [raw, alt, hrefRaw, title] = match;
	const href = (hrefRaw || '').trim();
	if (isVideoUrl(href) || isPdfUrl(href)) return null;

	return { raw, text: alt || '', href, title: title || null, darkSrc: null };
}

// Only the exact shape we write is claimed, so a <picture> with sources we do
// not model is never silently reduced to one light and one dark image.
function matchPicture(src) {
	const match = PICTURE_PATTERN.exec(src);
	if (!match) return null;

	const tags = match[1].split(/>\s*/).filter(Boolean);
	if (tags.length !== 2) return null;

	const source = parseTag(tags[0], 'source');
	const img = parseTag(tags[1], 'img');
	if (!source?.srcset || source.media !== DARK_MEDIA || !img?.src) return null;

	return {
		raw: match[0],
		text: img.alt ?? '',
		href: img.src,
		title: img.title ?? null,
		darkSrc: source.srcset,
	};
}

function parseTag(tag, name) {
	const match = new RegExp(`^<${name}((?:\\s+[a-z-]+="[^"]*")*)\\s*/?$`).exec(
		tag,
	);
	if (!match) return null;

	const attributes = {};
	for (const [, key, value] of match[1].matchAll(/([a-z-]+)="([^"]*)"/g)) {
		attributes[key] = unescapeAttribute(value);
	}
	return attributes;
}

export function renderImageMarkdown(node) {
	// Skip images still uploading/optimizing, or whose upload failed — their
	// `src` is a transient base64 preview that must never be written to saved
	// content. Once the upload resolves, `loading` clears and the node
	// re-serializes normally.
	if (node.attrs?.loading || node.attrs?.error) {
		return '';
	}

	const src = node.attrs?.src ?? '';
	const darkSrc = node.attrs?.darkSrc ?? '';
	const alt = node.attrs?.alt ?? '';
	const title = node.attrs?.title ?? '';
	const caption = (node.attrs?.caption ?? '').trim();

	let md = darkSrc
		? renderPicture({ src, darkSrc, alt, title })
		: title
		  ? `![${alt}](${src} "${title}")`
		  : `![${alt}](${src})`;

	// Add caption on next line (no blank line) if present
	if (caption) {
		md += `\n*${caption}*`;
	}

	return md;
}

function renderPicture({ src, darkSrc, alt, title }) {
	// srcset splits candidates on commas and descriptors on spaces, so both
	// must be percent-encoded or a Frappe filename with either would not load.
	const srcset = darkSrc.replaceAll(' ', '%20').replaceAll(',', '%2C');
	const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
	return [
		'<picture>',
		`  <source srcset="${escapeAttribute(srcset)}" media="${DARK_MEDIA}">`,
		`  <img src="${escapeAttribute(src)}" alt="${escapeAttribute(
			alt,
		)}"${titleAttribute}>`,
		'</picture>',
	].join('\n');
}

function escapeAttribute(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function unescapeAttribute(value) {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}
