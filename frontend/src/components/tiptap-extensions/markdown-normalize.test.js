import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';

import { canonicalizeMarkdown } from './markdown-normalize.js';
import { PreserveBlankLines } from './preserve-blank-lines.js';
import { wikiStarterKit } from './wiki-starterkit.js';

// Build the markdown manager from the same extension family WikiEditor feeds
// TipTap, so this exercises the real serialize/parse round-trip with no DOM.
function buildManager() {
	const starterKit = wikiStarterKit();
	const baseExtensions = starterKit.config.addExtensions.call({
		options: starterKit.options,
		name: 'starterKit',
	});
	return new MarkdownManager({
		extensions: [
			...baseExtensions,
			PreserveBlankLines,
			TaskList,
			TaskItem.configure({ nested: true }),
		],
		markedOptions: { breaks: true },
	});
}

const TASK_LIST = '- [x] one\n- [x] two\n- [x] three';
// The editor keeps a trailing empty paragraph for cursor placement, so a live
// task-list doc serializes with trailing newlines the server-stored copy lacks.
const TASK_LIST_WITH_TRAILING = `${TASK_LIST}\n\n\n\n`;

// Documents the round-trip instability behind the phantom-dirty bug:
// PreserveBlankLines turns the trailing blank lines back into empty paragraphs,
// so the two forms serialize to different strings even though they carry the
// same content.
test('raw round-trip retains trailing newlines, so the two forms diverge', () => {
	const manager = buildManager();
	const stripped = manager.serialize(manager.parse(TASK_LIST));
	const withTrailing = manager.serialize(
		manager.parse(TASK_LIST_WITH_TRAILING),
	);
	assert.notEqual(stripped, withTrailing);
});

// Regression for the stuck Submit-for-Review / Merge bug: the draft store
// compares these snapshots byte-for-byte (pageBuffers.isDirty), so
// canonicalizeMarkdown must collapse the trailing-newline-only difference or a
// saved page reads dirty forever.
test('canonicalizeMarkdown makes the trailing-only difference compare equal', () => {
	const manager = buildManager();
	assert.equal(
		canonicalizeMarkdown(manager, TASK_LIST),
		canonicalizeMarkdown(manager, TASK_LIST_WITH_TRAILING),
	);
});

// Only trailing newlines are dropped — the content itself must survive.
test('canonicalizeMarkdown preserves the task-list content', () => {
	const manager = buildManager();
	const result = canonicalizeMarkdown(manager, TASK_LIST_WITH_TRAILING);
	assert.match(result, /one/);
	assert.match(result, /two/);
	assert.match(result, /three/);
	assert.equal(/\n$/.test(result), false);
});

// The no-manager fallback (editor not ready) must also be trailing-insensitive,
// so an early comparison can't latch a phantom-dirty state.
test('canonicalizeMarkdown strips trailing newlines without a manager', () => {
	assert.equal(canonicalizeMarkdown(null, TASK_LIST_WITH_TRAILING), TASK_LIST);
});
