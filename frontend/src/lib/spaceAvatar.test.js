import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AVATAR_STYLES, randomAvatarSeed } from './spaceAvatar.js';

const SOURCE = fs.readFileSync(
	path.join(import.meta.dirname, 'spaceAvatar.js'),
	'utf8',
);

test('every offered style has a loader, and every loader an entry', () => {
	const offered = AVATAR_STYLES.map((style) => style.id).sort();
	// Read off the source rather than the object: STYLE_LOADERS is private, and
	// exporting it just to test it would invite an eager import of the styles.
	const loaded = [
		...SOURCE.matchAll(/import\('@dicebear\/styles\/([a-z]+)\.json'\)/g),
	]
		.map((match) => match[1])
		.sort();

	assert.deepEqual(loaded, offered);
});

test('the styles are only ever reached through a dynamic import', () => {
	// A bare `import` of a style or of the renderer would put hundreds of
	// kilobytes of style JSON in the entry chunk, which is the whole reason
	// this module exists apart from spaceIdentity.
	const staticImports = [...SOURCE.matchAll(/^import\s.*$/gm)].map(
		(match) => match[0],
	);
	assert.deepEqual(staticImports, []);
});

test('a seed is a fresh 16-character hex string', () => {
	const seed = randomAvatarSeed();
	assert.match(seed, /^[0-9a-f]{16}$/);
	assert.notEqual(seed, randomAvatarSeed());
});
