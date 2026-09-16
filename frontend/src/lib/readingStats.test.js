import assert from 'node:assert/strict';
import test from 'node:test';

import { countWords, readingMinutes } from './readingStats.js';

test('counts the words of a plain paragraph', () => {
	assert.equal(countWords('one two three four'), 4);
});

test('empty and missing content count as nothing', () => {
	assert.equal(countWords(''), 0);
	assert.equal(countWords(null), 0);
	assert.equal(countWords('   \n\n  '), 0);
});

test('markup is not prose', () => {
	assert.equal(countWords('## A heading'), 2);
	assert.equal(countWords('- one\n- two'), 2);
	assert.equal(countWords('> quoted words here'), 3);
	assert.equal(countWords('**bold** and _italic_'), 3);
});

test('code is skipped, fenced or inline', () => {
	assert.equal(countWords('before\n\n```js\nconst a = 1;\n```\n\nafter'), 2);
	assert.equal(countWords('run `npm install` now'), 2);
});

test('an unterminated fence swallows the rest, not the words before it', () => {
	assert.equal(countWords('intro words\n\n```\nnever closed'), 2);
});

test('a link reads as its label, an image as nothing', () => {
	assert.equal(countWords('see [the guide](https://example.com/a/b)'), 3);
	assert.equal(countWords('![a picture](/files/x.png)'), 0);
});

test('reading time rounds to whole minutes and never to zero', () => {
	assert.equal(readingMinutes(0), 0);
	assert.equal(readingMinutes(1), 1);
	assert.equal(readingMinutes(200), 1);
	assert.equal(readingMinutes(450), 2);
});
