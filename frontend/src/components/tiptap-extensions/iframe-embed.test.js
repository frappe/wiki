import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EMBED_HTML_PASTE_RE_G,
	EMBED_URL_PASTE_RE,
	iframeAttrsFromHtml,
	isAllowedIframeSrc,
	isEmbedUrlPaste,
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

// WikiEditor's handlePaste asks this before deciding whether to consume the
// event as markdown. A stale lastIndex here would make every other paste of the
// same URL fall through to markdown and land as a bare link.
test('isEmbedUrlPaste is stateless and only claims paste-alone embed URLs', () => {
	for (let i = 0; i < 3; i++) {
		assert.equal(isEmbedUrlPaste('https://www.youtube.com/watch?v=abc'), true);
		assert.equal(isEmbedUrlPaste('https://youtu.be/abc'), true);
	}
	assert.equal(
		isEmbedUrlPaste('watch https://www.youtube.com/watch?v=abc later'),
		false,
	);
	assert.equal(isEmbedUrlPaste('https://evil.example.com/x'), false);
	assert.equal(isEmbedUrlPaste(''), false);
	assert.equal(isEmbedUrlPaste(undefined), false);
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
	assert.equal(attrs.src, 'https://www.youtube-nocookie.com/embed/abc');
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
		'https://www.youtube-nocookie.com/embed/abc',
	);
});

test('normalizeEmbedUrl sends every youtube form to the nocookie host', () => {
	for (const url of [
		'https://youtu.be/abc',
		'https://www.youtube.com/shorts/abc',
	]) {
		assert.equal(
			normalizeEmbedUrl(url),
			'https://www.youtube-nocookie.com/embed/abc',
			url,
		);
	}
});

// YouTube's share dialog hangs a `?si=…` on the embed URL; moving the host must
// not drop it, or the pasted embed stops matching what the user copied.
test('normalizeEmbedUrl rehosts an existing embed URL and keeps its query', () => {
	assert.equal(
		normalizeEmbedUrl('https://www.youtube.com/embed/abc?si=XyZ'),
		'https://www.youtube-nocookie.com/embed/abc?si=XyZ',
	);
});

test('normalizeEmbedUrl carries a watch timestamp into ?start=', () => {
	assert.equal(
		normalizeEmbedUrl('https://www.youtube.com/watch?v=abc&t=90'),
		'https://www.youtube-nocookie.com/embed/abc?start=90',
	);
	assert.equal(
		normalizeEmbedUrl('https://youtu.be/abc?t=1m30s'),
		'https://www.youtube-nocookie.com/embed/abc?start=90',
	);
});

test('normalizeEmbedUrl leaves non-youtube providers alone', () => {
	assert.equal(
		normalizeEmbedUrl('https://vimeo.com/12345'),
		'https://player.vimeo.com/video/12345',
	);
	assert.equal(
		normalizeEmbedUrl('https://codepen.io/team/pen/abc'),
		'https://codepen.io/team/pen/abc',
	);
});
