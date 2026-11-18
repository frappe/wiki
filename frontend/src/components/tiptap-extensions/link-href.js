import { docKeyFromHref } from './page-links.js';

const URL_WITH_AUTHORITY = /^[a-zA-Z]+:\/\//;
const MAILTO_LINK = /^mailto:/i;
// Stops at `?` so an sms body keeps its hyphens.
const PHONE_LINK_NUMBER = /^(?:tel|sms):[^?]*/i;
const BARE_PHONE_NUMBER = /^\+?[\s()-]*\d[\d\s()-]*$/;
const PHONE_SEPARATORS = /[\s()-]/g;

/** The href to store for what the user typed, or null when it is not a link. */
export function parseLinkHref(input) {
	const href = normalizeHref(input.trim());
	return isRelativeHref(href) || URL.canParse(href) ? href : null;
}

function normalizeHref(href) {
	if (
		isRelativeHref(href) ||
		URL_WITH_AUTHORITY.test(href) ||
		MAILTO_LINK.test(href)
	) {
		return href;
	}
	if (BARE_PHONE_NUMBER.test(href)) return `tel:${stripPhoneSeparators(href)}`;
	if (PHONE_LINK_NUMBER.test(href)) {
		return href.replace(PHONE_LINK_NUMBER, stripPhoneSeparators);
	}
	return `https://${href}`;
}

function isRelativeHref(href) {
	return href.startsWith('/') || href.startsWith('#') || docKeyFromHref(href);
}

// A space would end the destination of the stored `[text](href)` markdown.
function stripPhoneSeparators(number) {
	return number.replace(PHONE_SEPARATORS, '');
}
