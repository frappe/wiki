import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parseLinkHref } from './link-href.js';

test.each([
	['tel:+41791112233', 'tel:+41791112233'],
	['TEL:+41791112233', 'TEL:+41791112233'],
	['tel:+41 79 111 22 33', 'tel:+41791112233'],
	['sms:+41791112233', 'sms:+41791112233'],
	['sms:+41 79 111?body=10-11', 'sms:+4179111?body=10-11'],
	['mailto:team@example.com', 'mailto:team@example.com'],
])('keeps the scheme of %s', (input, href) => {
	assert.equal(parseLinkHref(input), href);
});

test.each([
	['+41791112233', 'tel:+41791112233'],
	['079 111 22 33', 'tel:0791112233'],
	['(079) 111-22-33', 'tel:0791112233'],
	['  +41 79 111 22 33  ', 'tel:+41791112233'],
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

test.each(['javascript:alert(1)', 'data:text/html,hello', 'not a link'])(
	'rejects %s',
	(input) => {
		assert.equal(parseLinkHref(input), null);
	},
);
