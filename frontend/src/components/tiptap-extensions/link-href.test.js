import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isUnsafeHref, parseLinkHref } from './link-href.js';

test.each([
	['tel:+41791112233', 'tel:+41791112233'],
	['TEL:+41791112233', 'TEL:+41791112233'],
	['tel:+41 79 111 22 33', 'tel:+41791112233'],
	['sms:+41791112233', 'sms:+41791112233'],
	['sms:+41 79 111?body=10-11', 'sms:+4179111?body=10-11'],
	['tel:2024', 'tel:2024'],
	['tel:+12015550123;ext=102', 'tel:+12015550123;ext=102'],
	['mailto:team@example.com', 'mailto:team@example.com'],
	['MAILTO:team@example.com', 'MAILTO:team@example.com'],
	['mailto:a@example.com,b@example.com', 'mailto:a@example.com,b@example.com'],
])('keeps the scheme of %s', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test.each([
	['+41791112233', 'tel:+41791112233'],
	['079 111 22 33', 'tel:0791112233'],
	['(079) 111-22-33', 'tel:0791112233'],
	['  +41 79 111 22 33  ', 'tel:+41791112233'],
	['+1 (201) 555-0123', 'tel:+12015550123'],
	['555-123-4567', 'tel:5551234567'],
])('turns the phone number %s into a tel link', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test.each([
	['example.com', 'https://example.com'],
	['example.com:8080/docs', 'https://example.com:8080/docs'],
	['localhost:8000', 'https://localhost:8000'],
	['192.168.1.10', 'https://192.168.1.10'],
	['https://example.com', 'https://example.com'],
	['ftp://example.com', 'ftp://example.com'],
])('treats %s as a web address', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test.each(['/docs/setup', '#install', 'wiki:abc123'])(
	'keeps the internal link %s',
	(href) => {
		assert.equal(parseLinkHref(href), href);
	},
);

test.each([
	['team@example.com', 'mailto:team@example.com'],
	[
		'first.last+tag@sub.example.co.uk',
		'mailto:first.last+tag@sub.example.co.uk',
	],
	['  team@example.com  ', 'mailto:team@example.com'],
])('turns the email address %s into a mailto link', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test.each([
	['https://example.com/my file.pdf', 'https://example.com/my%20file.pdf'],
	['example.com/my file', 'https://example.com/my%20file'],
	['/docs/my page', '/docs/my%20page'],
	['#my heading', '#my%20heading'],
	['https://example.com/a)b', 'https://example.com/a%29b'],
	['https://example.com/a(b', 'https://example.com/a%28b'],
	['https://example.com/a<b>', 'https://example.com/a%3Cb%3E'],
	['https://example.com/a|b', 'https://example.com/a%7Cb'],
	[
		'mailto:team@example.com?subject=Hi there',
		'mailto:team@example.com?subject=Hi%20there',
	],
	['sms:+41791112233?body=Hi there', 'sms:+41791112233?body=Hi%20there'],
])('keeps %s a valid markdown link', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test('keeps balanced parentheses readable', () => {
	const href = 'https://en.wikipedia.org/wiki/Link_(film)';
	assert.equal(parseLinkHref(href), href);
});

test.each([
	'2024',
	'0791112233',
	'+2024',
	'2024-11-18',
	'555-1234',
	'1.5',
	'2024.11.18',
	'2024/11',
])('does not guess that the number %s is a link', (input) => {
	assert.equal(parseLinkHref(input), null);
});

test.each([
	'javascript:alert(1)',
	'JavaScript:alert(1)',
	'javascript://%0aalert(1)',
	'javascript:80',
	'java\tscript:alert(1)',
	'\u0001javascript:alert(1)',
	'data:text/html,hello',
	'data://text/html,x',
	'vbscript:msgbox(1)',
	'file:///etc/passwd',
	'blob:https://example.com/id',
	'about:blank',
	'slack://channel',
	'custom:/path',
])('rejects the unsafe or unknown scheme in %j', (input) => {
	assert.equal(parseLinkHref(input), null);
});

test.each([
	'',
	'   ',
	'not a link',
	'foo bar',
	'https://foo bar',
	'https://foo%20bar',
	'foo%20bar',
	'https://foo<bar>.com',
	'https://',
	'http:example.com',
	'mailto:',
	'mailto:team',
	'mailto:a b@example.com',
	'tel:',
	'tel:call-me',
	'sms:abc',
	'team@example',
	'user:secret@example.com',
	'wiki:abc def',
	'wiki:',
])('rejects the invalid link %j', (input) => {
	assert.equal(parseLinkHref(input), null);
});

test.each([
	'javascript:alert(1)',
	' JAVASCRIPT:alert(1)',
	'java\nscript:alert(1)',
	'\u0001javascript:alert(1)',
	'vbscript:x',
	'data:text/html,x',
	'file:///etc/passwd',
])('flags %j as unsafe', (href) => {
	assert.equal(isUnsafeHref(href), true);
});

test.each([
	'https://example.com/javascript:alert(1)',
	'/data:x',
	'#javascript:x',
	'slack://channel',
	'tel:+41791112233',
	'wiki:abc123',
	'',
	null,
	undefined,
])('does not flag %j as unsafe', (href) => {
	assert.equal(isUnsafeHref(href), false);
});
