import assert from 'node:assert/strict';
import test from 'node:test';

import { getLoaderUrl, getMermaid } from './mermaid-loader.js';
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
	const diagram = SLASH_COMMANDS.find((command) => command.title === 'Diagram');
	assert.ok(diagram);
	// "/mermaid" must keep finding it for longtime users.
	assert.ok(diagram.keywords.includes('mermaid'));
});

test('loads mermaid through the shared public loader', async () => {
	const originalWindow = global.window;
	const mermaid = {};
	let receivedOptions = 'not called';

	global.window = {
		wikiGetMermaid(options) {
			receivedOptions = options;
			return Promise.resolve(mermaid);
		},
	};

	try {
		assert.equal(await getMermaid(), mermaid);
		// The shared loader owns (and versions) the vendor URL.
		assert.equal(receivedOptions, undefined);
	} finally {
		global.window = originalWindow;
	}
});

test('cache-busts the shared loader with the hash from boot', () => {
	const originalWindow = global.window;

	try {
		global.window = { asset_hashes: { mermaid_loader: 'abc123' } };
		assert.equal(getLoaderUrl(), '/assets/wiki/js/mermaid-loader.js?v=abc123');
	} finally {
		global.window = originalWindow;
	}
});

test('falls back to the bare loader path when no hash is booted', () => {
	const originalWindow = global.window;

	try {
		global.window = {};
		assert.equal(getLoaderUrl(), '/assets/wiki/js/mermaid-loader.js');

		global.window = { asset_hashes: {} };
		assert.equal(getLoaderUrl(), '/assets/wiki/js/mermaid-loader.js');
	} finally {
		global.window = originalWindow;
	}
});
