import assert from 'node:assert/strict';
import test from 'node:test';

import {
	diffBlocks,
	foldUnchanged,
	renderInline,
	renderSide,
	summarize,
	tokenize,
} from './blockDiff.js';

const block = (tag, html) => ({ tag, html, key: html });
const p = (text) => block('p', `<p>${text}</p>`);
const strip = (html) => html.replace(/ class="[^"]*"/g, '');

test('unchanged blocks line up and added ones stand alone', () => {
	const rows = diffBlocks([p('One'), p('Two')], [p('One'), p('New'), p('Two')]);
	assert.deepEqual(
		rows.map((row) => row.kind),
		['same', 'add', 'same'],
	);
});

test('a removed run next to an added run pairs into edits by position', () => {
	const rows = diffBlocks([p('One'), p('Old')], [p('One'), p('New')]);
	assert.deepEqual(
		rows.map((row) => row.kind),
		['same', 'change'],
	);
	assert.equal(rows[1].before.html, '<p>Old</p>');
	assert.equal(rows[1].after.html, '<p>New</p>');
});

test('blocks of different tags never pair', () => {
	const rows = diffBlocks([p('Text')], [block('h2', '<h2>Text</h2>')]);
	assert.deepEqual(
		rows.map((row) => row.kind),
		['del', 'add'],
	);
});

test('an edited paragraph highlights the changed words on each side', () => {
	const [row] = diffBlocks(
		[p('Requires Frappe v15 or v16.')],
		[p('Requires Frappe v15.20 or later.')],
	);
	assert.equal(
		strip(renderSide(row.tokens, 'before')),
		'<p>Requires Frappe v15 or <del>v16</del>.</p>',
	);
	assert.equal(
		strip(renderSide(row.tokens, 'after')),
		'<p>Requires Frappe v15<ins>.20</ins> or <ins>later</ins>.</p>',
	);
});

test('each side keeps its own markup whole', () => {
	const [row] = diffBlocks(
		[p('Hello <strong>world</strong>')],
		[p('Hello <strong>wiki</strong>')],
	);
	assert.equal(
		strip(renderSide(row.tokens, 'before')),
		'<p>Hello <strong><del>world</del></strong></p>',
	);
	assert.equal(
		strip(renderSide(row.tokens, 'after')),
		'<p>Hello <strong><ins>wiki</ins></strong></p>',
	);
});

test('inline keeps the after markup and puts deleted words back as text', () => {
	const [row] = diffBlocks(
		[p('Hello <strong>world</strong>')],
		[p('Hello <em>wiki</em>')],
	);
	assert.equal(
		strip(renderInline(row.tokens)),
		'<p>Hello <del>world</del><em><ins>wiki</ins></em></p>',
	);
});

test('blocks outside the text tags show whole when edited', () => {
	const [row] = diffBlocks(
		[block('table', '<table>1</table>')],
		[block('table', '<table>2</table>')],
	);
	assert.equal(row.kind, 'change');
	assert.equal(row.tokens, null);
});

test('a very long edited block falls back to showing it whole', () => {
	const long = (word) => p(Array.from({ length: 600 }, () => word).join(' '));
	const [row] = diffBlocks([long('a')], [long('b')]);
	assert.equal(row.tokens, null);
});

test('runs of unchanged blocks fold into one gap', () => {
	const rows = diffBlocks(
		[p('1'), p('2'), p('3'), p('4')],
		[p('1'), p('2'), p('3'), p('5')],
	);
	assert.deepEqual(foldUnchanged(rows), [{ kind: 'gap', count: 3 }, rows[3]]);
});

test('the summary counts added, edited and removed blocks', () => {
	const rows = diffBlocks(
		[p('1'), p('2'), block('hr', '<hr>')],
		[p('1'), p('two'), p('3')],
	);
	assert.deepEqual(summarize(rows), { added: 1, edited: 1, removed: 1 });
});

test('tokens keep tags, words, punctuation and spaces apart', () => {
	assert.deepEqual(tokenize('<p>a  b.</p>'), [
		'<p>',
		'a',
		'  ',
		'b',
		'.',
		'</p>',
	]);
});

test('an entity stays one token, so a highlight never splits it', () => {
	assert.deepEqual(tokenize('A --&gt; B'), [
		'A',
		' ',
		'-',
		'-',
		'&gt;',
		' ',
		'B',
	]);
});
