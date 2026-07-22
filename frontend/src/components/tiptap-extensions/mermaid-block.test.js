import assert from 'node:assert/strict';
import test from 'node:test';

import { getMermaid } from './mermaid-loader.js';
import { parseMermaidFence, renderMermaidFence } from './mermaid-markdown.js';
import { SLASH_COMMANDS } from './slash-commands.js';

test('parses mermaid fenced code blocks', () => {
	const source = '```mermaid\nflowchart TD\n  A --> B\n```\n';
	const parsed = parseMermaidFence(source);

	assert.deepEqual(parsed, {
		raw: source,
		code: 'flowchart TD\n  A --> B',
	});
});

test('renders mermaid blocks back to fenced markdown', () => {
	assert.equal(
		renderMermaidFence('sequenceDiagram\n  Alice->>Bob: Hello'),
		'```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n\n',
	);
});

test('exposes a slash command for inserting mermaid diagrams', () => {
	assert.ok(SLASH_COMMANDS.some((command) => command.title === 'Mermaid'));
});

test('loads mermaid through the shared public loader', async () => {
	const originalWindow = global.window;
	const mermaid = {};
	let receivedOptions;

	global.window = {
		wikiGetMermaid(options) {
			receivedOptions = options;
			return Promise.resolve(mermaid);
		},
	};

	try {
		assert.equal(await getMermaid(), mermaid);
		assert.equal(
			receivedOptions.assetUrl,
			'/assets/wiki/js/vendor/mermaid/mermaid.min.js',
		);
	} finally {
		global.window = originalWindow;
	}
});
