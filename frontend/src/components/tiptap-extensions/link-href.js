import { WIKI_LINK_PREFIX } from './page-links.js';

const DELETE = '\u007f';
const UNSAFE_SCHEME = /^(?:javascript|vbscript|data|file):/i;

const PAGE_LINK = /^wiki:\w+$/;
const WEB_URL = /^(?:https?|ftp):\/\//i;
const MAILTO_SCHEME = /^mailto:/i;
const MAILTO_LINK = /^mailto:[^\s?@]+@[^\s?]+(?:\?.*)?$/i;
// Stops at `?` so an sms body keeps its hyphens.
const PHONE_LINK_NUMBER = /^(?:tel|sms):[^?]*/i;
const PHONE_LINK = /^(?:tel|sms):\+?[\d*#]+(?:[;,][^?]*)?(?:\?.*)?$/i;
const EMAIL_ADDRESS = /^[^\s@/:?#]+@[^\s@/:?#]+\.[^\s@/:?#]+$/;

const BARE_PHONE_NUMBER = /^\+?[\s()-]*\d[\d\s()-]*$/;
const PHONE_SEPARATOR = /[\s()-]/;
const PHONE_SEPARATORS = new RegExp(PHONE_SEPARATOR, 'g');
const MIN_INTERNATIONAL_DIGITS = 7;
const MIN_NATIONAL_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
// Checked before encoding: Chromium accepts a host like `foo%20bar`.
const WEB_AUTHORITY = /^[^\s%<>\\|()/?#]+(?:[/?#]|$)/;
const HOST_AND_PORT = /^[^\s/:?#]+:\d+(?:[/?#]|$)/;
const NUMERIC_HOST = /^[\d.]+$/;
const IPV4_ADDRESS = /^\d+(?:\.\d+){3}$/;

// Each of these would end or split the stored `[text](href)` markdown.
const MARKDOWN_BREAKING = /[\s<>\\|]/g;

/** The href to store for what the user typed, or null when it is not a link. */
export function parseLinkHref(input) {
	const value = input.trim();
	if (!value || hasControlCharacter(value) || isUnsafeHref(value)) {
		return null;
	}
	const href = normalizeHref(value);
	if (!href) return null;
	const destination = toMarkdownDestination(href);
	return isRelativeHref(destination) || URL.canParse(destination)
		? destination
		: null;
}

/** Whether following this href could run script or read local content. */
export function isUnsafeHref(href) {
	// Browsers drop these while reading a scheme, so `java\tscript:` still runs.
	const scheme = [...(href ?? '')].filter((c) => c > ' ' && c !== DELETE);
	return UNSAFE_SCHEME.test(scheme.join(''));
}

function hasControlCharacter(value) {
	return [...value].some((c) => c < ' ' || c === DELETE);
}

function normalizeHref(value) {
	if (isRelativeHref(value)) return value;
	if (WEB_URL.test(value)) {
		return WEB_AUTHORITY.test(value.replace(WEB_URL, '')) ? value : null;
	}
	if (value.startsWith(WIKI_LINK_PREFIX)) {
		return PAGE_LINK.test(value) ? value : null;
	}
	if (MAILTO_SCHEME.test(value)) return MAILTO_LINK.test(value) ? value : null;
	if (PHONE_LINK_NUMBER.test(value)) {
		const href = value.replace(PHONE_LINK_NUMBER, stripPhoneSeparators);
		return PHONE_LINK.test(href) ? href : null;
	}
	if (EMAIL_ADDRESS.test(value)) return `mailto:${value}`;
	if (BARE_PHONE_NUMBER.test(value)) {
		return isClearlyPhoneNumber(value)
			? `tel:${stripPhoneSeparators(value)}`
			: null;
	}
	return bareWebAddress(value);
}

function isRelativeHref(href) {
	return href.startsWith('/') || href.startsWith('#') || PAGE_LINK.test(href);
}

// A year or a count is not a phone number: it needs a `+` or visible grouping.
function isClearlyPhoneNumber(value) {
	const digits = value.replace(/\D/g, '').length;
	if (digits > MAX_PHONE_DIGITS) return false;
	if (value.startsWith('+')) return digits >= MIN_INTERNATIONAL_DIGITS;
	return digits >= MIN_NATIONAL_DIGITS && PHONE_SEPARATOR.test(value);
}

function bareWebAddress(value) {
	if (SCHEME.test(value) && !HOST_AND_PORT.test(value)) return null;
	if (!WEB_AUTHORITY.test(value)) return null;
	const authority = value.split(/[/?#]/, 1)[0];
	if (authority.includes('@')) return null;
	const host = authority.replace(/:\d+$/, '');
	if (NUMERIC_HOST.test(host) && !IPV4_ADDRESS.test(host)) return null;
	return `https://${value}`;
}

function toMarkdownDestination(href) {
	const encoded = href.replace(MARKDOWN_BREAKING, encodeURIComponent);
	if (hasBalancedParentheses(encoded)) return encoded;
	return encoded.replaceAll('(', '%28').replaceAll(')', '%29');
}

function hasBalancedParentheses(text) {
	let depth = 0;
	for (const character of text) {
		if (character === '(') depth++;
		if (character === ')' && --depth < 0) return false;
	}
	return depth === 0;
}

// A space would end the destination of the stored `[text](href)` markdown.
function stripPhoneSeparators(number) {
	return number.replace(PHONE_SEPARATORS, '');
}
