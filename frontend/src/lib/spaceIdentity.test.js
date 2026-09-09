import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_SPACE_ICON,
	SPACE_COLORS,
	generatedIdentityPatch,
	resolveSpaceIdentity,
	spaceAvatarSrc,
	spaceColorTheme,
	spaceIconClass,
} from './spaceIdentity.js';

const SVG = 'data:image/svg+xml;utf8,<svg/>';

test('a generated mark beats an icon, which beats an uploaded logo', () => {
	const space = {
		name: 'SPACE-1',
		avatar: SVG,
		space_icon: 'lucide-rocket',
		app_switcher_logo: '/files/logo.png',
	};
	assert.equal(resolveSpaceIdentity(space).mode, 'avatar');

	const { avatar, ...noAvatar } = space;
	assert.equal(resolveSpaceIdentity(noAvatar).mode, 'icon');

	const { space_icon, ...logoOnly } = noAvatar;
	assert.equal(resolveSpaceIdentity(logoOnly).mode, 'logo');

	const { app_switcher_logo, ...bare } = logoOnly;
	assert.equal(resolveSpaceIdentity(bare).mode, 'initial');
});

test('a space with nothing set still resolves', () => {
	const identity = resolveSpaceIdentity(undefined);
	assert.equal(identity.mode, 'initial');
	assert.ok(SPACE_COLORS.includes(identity.color));
});

test('an unusable avatar falls through instead of drawing nothing', () => {
	const space = { name: 'SPACE-1', avatar: '<svg onload="alert(1)"/>' };
	assert.equal(resolveSpaceIdentity(space).mode, 'initial');
});

test('only an SVG data URI survives the sanitizer', () => {
	assert.equal(spaceAvatarSrc(SVG), SVG);
	assert.equal(spaceAvatarSrc(` ${SVG} `), SVG);
	assert.equal(spaceAvatarSrc('data:image/svg+xml'), '');
	assert.equal(spaceAvatarSrc('data:text/html,<script>'), '');
	assert.equal(spaceAvatarSrc('javascript:alert(1)'), '');
	assert.equal(spaceAvatarSrc('/files/logo.png'), '');
	assert.equal(spaceAvatarSrc(null), '');
});

test('an off-palette colour falls back to a derived one', () => {
	assert.equal(spaceColorTheme('blue', 'SPACE-1'), 'blue');
	assert.ok(SPACE_COLORS.includes(spaceColorTheme('fuchsia', 'SPACE-1')));
	assert.ok(SPACE_COLORS.includes(spaceColorTheme('', 'SPACE-1')));
	assert.ok(SPACE_COLORS.includes(spaceColorTheme(null, null)));
});

test('a derived colour survives a rename', () => {
	assert.equal(
		spaceColorTheme('', 'SPACE-1'),
		spaceColorTheme(undefined, 'SPACE-1'),
	);
	assert.notEqual(spaceColorTheme('', 'SPACE-1'), spaceColorTheme('', 'x'));
});

test('a class Tailwind never emitted falls back to the default icon', () => {
	assert.equal(spaceIconClass('lucide-rocket'), 'lucide-rocket');
	assert.equal(spaceIconClass('rocket'), DEFAULT_SPACE_ICON);
	assert.equal(spaceIconClass(''), DEFAULT_SPACE_ICON);
	assert.equal(spaceIconClass(null), DEFAULT_SPACE_ICON);
});

test('the patch always writes all five fields, so a save can clear one', () => {
	assert.deepEqual(
		generatedIdentityPatch({ icon: 'lucide-rocket', color: 'blue' }),
		{
			space_icon: 'lucide-rocket',
			space_color: 'blue',
			avatar: '',
			avatar_style: '',
			avatar_seed: '',
		},
	);

	assert.deepEqual(
		generatedIdentityPatch({
			avatar: { svg: SVG, style: 'glass', seed: 'abc123' },
		}),
		{
			space_icon: '',
			space_color: '',
			avatar: SVG,
			avatar_style: 'glass',
			avatar_seed: 'abc123',
		},
	);
});

test('the patch never touches the uploaded logo', () => {
	const patch = generatedIdentityPatch({ icon: 'lucide-rocket' });
	assert.equal('app_switcher_logo' in patch, false);
});
