// Words and reading time for the draft that is on screen, computed here rather
// than asked of the server: the number has to track the buffer between saves,
// and the buffer only exists in the browser.

const WORDS_PER_MINUTE = 200;

/**
 * Words in a Markdown document, counting prose only — code blocks, URLs and
 * the markup itself are not something anyone reads.
 */
export function countWords(markdown) {
	if (!markdown) return 0;
	const prose = markdown
		.replace(/```[\s\S]*?(```|$)/g, ' ')
		.replace(/`[^`]*`/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		// A link reads as its label; the target is not prose.
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[#>*_~|=+-]/g, ' ');
	return prose.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
		.length;
}

/** Whole minutes, and never zero: a one-line page still takes a moment. */
export function readingMinutes(words) {
	if (!words) return 0;
	return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
