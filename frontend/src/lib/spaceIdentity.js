// A space's visual identity: a generated mark, a lucide icon on a tinted
// square, or an uploaded logo. Every surface that shows a space — the library
// sidebar, the space header, the overview rows, and the public reader through
// its own port of these rules — resolves it the same way.
//
// The DiceBear half lives in `lib/spaceAvatar.js`, which loads a megabyte of
// style definitions and so must stay out of the path that merely *draws* a
// space. Nothing here imports it.

// Exactly frappe-ui's `AvatarTheme` union. Deriving the palette from the
// component means a space colour can only ever resolve to a tint the design
// system already ships — no hand-written class map to drift off-palette, and
// the same six exist as `--surface-*-2` / `--ink-*-7` in the reader's separate
// Tailwind build.
export const SPACE_COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'violet'];

// The stand-in when no icon has been picked. Unlike the colour it is not
// derived: an icon carries meaning, and hashing one out of the space name
// would claim a meaning nobody chose.
export const DEFAULT_SPACE_ICON = 'lucide-book-open-text';

// An SVG is a script host: `<svg><script>` and `onload=` both run, and `avatar`
// is a field any Wiki Manager can write. So a stored mark never becomes markup
// — it is only ever an `<img>` source, which does not execute script, and only
// after it has proved to be an SVG data URI. Anything else resolves to '', and
// the caller falls back to the icon.
const AVATAR_DATA_URI = /^data:image\/svg\+xml[;,]/i;

export function spaceAvatarSrc(avatar) {
	const value = (avatar ?? '').trim();
	return AVATAR_DATA_URI.test(value) ? value : '';
}

// Anything missing or outside the curated list would render as an empty box:
// Tailwind only emits a `lucide-*` rule for a class it found as a literal at
// build time, and these values arrive from the database at runtime.
export function spaceIconClass(icon) {
	const value = (icon ?? '').trim();
	return value.startsWith('lucide-') ? value : DEFAULT_SPACE_ICON;
}

// Colour falls back to a hash of the space's docname, which Frappe never
// rewrites on a title change — so a space keeps its colour across a rename. A
// fixed neutral would be stable too, but it would leave every space that
// predates this field looking identical, which is the thing the mark exists to
// fix.
export function spaceColorTheme(color, seed) {
	const value = (color ?? '').trim();
	if (SPACE_COLORS.includes(value)) return value;
	return SPACE_COLORS[hash(seed ?? '') % SPACE_COLORS.length];
}

// Small deterministic string hash — same input, same colour, forever.
function hash(seed) {
	let value = 0;
	for (let index = 0; index < seed.length; index++) {
		value = (value * 31 + seed.charCodeAt(index)) | 0;
	}
	return Math.abs(value);
}

// The three identities in priority order. Only one is ever set by the picker —
// choosing an upload clears the generated fields — so the order only decides
// what a hand-edited row shows. `mode` is what a caller renders: 'avatar' and
// 'logo' both mean "draw `image`", 'icon' means "draw `icon` on `color`".
export function resolveSpaceIdentity(space) {
	const doc = space ?? {};
	const avatar = spaceAvatarSrc(doc.avatar);
	const color = spaceColorTheme(doc.space_color, doc.name);

	if (avatar) return { mode: 'avatar', image: avatar, icon: '', color };
	if (doc.space_icon) {
		return {
			mode: 'icon',
			image: '',
			icon: spaceIconClass(doc.space_icon),
			color,
		};
	}
	if (doc.app_switcher_logo) {
		return { mode: 'logo', image: doc.app_switcher_logo, icon: '', color };
	}
	// No mark at all: the label's initial on the derived tint, which is what
	// frappe-ui's Avatar draws when it has neither an image nor a slot.
	return { mode: 'initial', image: '', icon: '', color };
}

// The fields to write for a chosen identity. Every key is always present, and
// empty rather than absent, because a save has to be able to *clear* one:
// switching to an uploaded logo means writing four empty strings, and an
// omitted key would leave the old mark in the row.
//
// `app_switcher_logo` is deliberately not part of this. Picking an icon must
// not drop a File link the user uploaded — the Upload tab owns that field, and
// it is the only direction that clears.
export function generatedIdentityPatch({
	icon = '',
	color = '',
	avatar = null,
}) {
	return {
		space_icon: icon,
		space_color: color,
		avatar: avatar?.svg ?? '',
		avatar_style: avatar?.style ?? '',
		avatar_seed: avatar?.seed ?? '',
	};
}
