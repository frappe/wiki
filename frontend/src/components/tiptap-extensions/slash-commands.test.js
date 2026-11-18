import assert from 'node:assert/strict';
import { test } from 'vitest';

import { DEFAULT_TITLES } from './callout-markdown.js';
import { SLASH_COMMANDS, filterCommands } from './slash-commands.js';

function insertedCalloutType(command) {
	let type = null;
	const chain = {
		focus: () => chain,
		deleteRange: () => chain,
		setCallout: (attrs) => {
			type = attrs.type;
			return chain;
		},
		run: () => true,
	};
	command.command({ editor: { chain: () => chain }, range: {} });
	return type;
}

test('each callout item is named after the callout it inserts', () => {
	const callouts = SLASH_COMMANDS.filter((cmd) => cmd.group === 'Callouts');
	assert.ok(callouts.length > 0);
	for (const command of callouts) {
		assert.equal(command.title, DEFAULT_TITLES[insertedCalloutType(command)]);
	}
});

test('/warning still finds the caution callout', () => {
	assert.deepEqual(
		filterCommands('warning').map((cmd) => cmd.title),
		['Caution'],
	);
});
