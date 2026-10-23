import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMermaid } from '../../../wiki/public/js/mermaid-renderer.js';

function fakeRoot(source) {
	const diagram = {
		textContent: source,
		processed: false,
		setAttribute() {
			this.processed = true;
		},
	};
	return {
		diagram,
		querySelectorAll: () => (diagram.processed ? [] : [diagram]),
	};
}

test('overlapping calls draw each diagram once, from its source', async () => {
	const root = fakeRoot('graph LR\n  A --> B');
	const mounted = [];
	const mount = (el, source) => {
		mounted.push(source);
		el.textContent = 'AB';
	};
	const getMount = async () => mount;

	await Promise.all([
		renderMermaid(root, getMount),
		renderMermaid(root, getMount),
	]);

	assert.deepEqual(mounted, ['graph LR\n  A --> B']);
});
