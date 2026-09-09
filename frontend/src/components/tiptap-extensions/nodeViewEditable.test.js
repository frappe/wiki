import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Comment lines are dropped rather than comment *spans*: a regex that pairs
// `/*` with `*/` across a .vue file swallows most of the template with them.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|<!--|-->)/;

function codeLines(source) {
	return source
		.split('\n')
		.filter((line) => !COMMENT_LINE.test(line))
		.join('\n');
}

// A node view's first render runs inside the editor's own `createView`, before
// `editor.view` exists. `editor.isEditable` reaches through `view`, so reading
// it there throws, the render aborts, and tiptap then reports the node view as
// missing its NodeViewWrapper -- which fails the *whole* document, not just the
// one node. A page with a single callout in it rendered completely blank.
//
// `useNodeViewEditable` is the guarded read. This has been missed twice now, so
// the rule is asserted rather than remembered.
test('no node view reads editor.isEditable directly', () => {
	const offenders = readdirSync(here)
		.filter((name) => name.endsWith('View.vue'))
		.filter((name) =>
			/\beditor\??\.isEditable\b/.test(
				codeLines(readFileSync(join(here, name), 'utf8')),
			),
		);

	assert.deepEqual(
		offenders,
		[],
		`Read editability through useNodeViewEditable instead: ${offenders.join(
			', ',
		)}`,
	);
});
