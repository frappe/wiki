import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EMBED_HTML_PASTE_RE_G,
	EMBED_URL_PASTE_RE,
	iframeAttrsFromHtml,
	isAllowedIframeSrc,
	normalizeEmbedUrl,
} from './iframe-embed.js';

// Regression: TipTap's paste-rule engine feeds each `find` to String.matchAll(),
// which throws "called with a non-global RegExp argument" unless the regex is
// global. Both paste-rule patterns must therefore carry the `g` flag, or every
// paste into the editor blows up in appendTransaction. See issue #667.
test('paste-rule regexes are global so matchAll() does not throw', () => {
	for (const re of [EMBED_URL_PASTE_RE, EMBED_HTML_PASTE_RE_G]) {
		assert.ok(re.global, `${re} must have the global flag`);
		assert.doesNotThrow(() => [...'just some pasted text'.matchAll(re)]);
	}
});

test('URL paste regex matches a paste that is only an allowlisted embed URL', () => {
	const text = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
	const matches = [...text.matchAll(EMBED_URL_PASTE_RE)];
	assert.equal(matches.length, 1);
	assert.equal(matches[0][1], text);
});

test('URL paste regex ignores an embed URL sitting inside a sentence', () => {
	const text = 'see https://www.youtube.com/watch?v=x for details';
	assert.equal([...text.matchAll(EMBED_URL_PASTE_RE)].length, 0);
});

test('HTML paste regex extracts attrs from a self-contained <iframe>', () => {
	const html =
		'<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>';
	const matches = [...html.matchAll(EMBED_HTML_PASTE_RE_G)];
	assert.equal(matches.length, 1);
	const attrs = iframeAttrsFromHtml(matches[0][0]);
	assert.equal(attrs.src, 'https://www.youtube.com/embed/abc');
	assert.equal(attrs.width, '560');
});

// iframeAttrsFromHtml uses a shared non-global regex via .exec(); guard against a
// regression where it gains the `g` flag and starts carrying lastIndex between
// calls (which would make every other call spuriously return null).
test('iframeAttrsFromHtml is stateless across repeated calls', () => {
	const html = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
	for (let i = 0; i < 3; i++) {
		assert.equal(
			iframeAttrsFromHtml(html).src,
			'https://player.vimeo.com/video/1',
		);
	}
});

test('disallowed hosts are rejected on parse', () => {
	assert.equal(isAllowedIframeSrc('https://evil.example.com/x'), false);
	assert.equal(
		iframeAttrsFromHtml('<iframe src="https://evil.example.com/x"></iframe>'),
		null,
	);
});

test('normalizeEmbedUrl upgrades a youtube watch URL to its embed URL', () => {
	assert.equal(
		normalizeEmbedUrl('https://www.youtube.com/watch?v=abc'),
		'https://www.youtube.com/embed/abc',
	);
});
