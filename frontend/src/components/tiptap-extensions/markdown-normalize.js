// Canonicalize markdown for dirty-state comparison.
//
// The editor keeps a trailing empty paragraph for cursor placement, and
// PreserveBlankLines round-trips trailing blank lines back into empty
// paragraphs, so the editor's serialized markdown ends with newlines that a
// server-stored copy (which is stripped) does not. The draft store compares
// these snapshots byte-for-byte to decide whether a page is dirty, so the
// trailing-newline difference alone strands a page as permanently "unsaved" —
// gating Submit for Review / Merge forever. Trailing newlines carry no content,
// so strip them before comparison.
export function canonicalizeMarkdown(manager, content) {
	const markdown = content ?? '';
	if (!manager) return stripTrailingNewlines(markdown);
	try {
		return stripTrailingNewlines(manager.serialize(manager.parse(markdown)));
	} catch (error) {
		console.warn('[WikiEditor] Could not normalize markdown', error);
		return stripTrailingNewlines(markdown);
	}
}

function stripTrailingNewlines(markdown) {
	return markdown.replace(/\n+$/, '');
}
