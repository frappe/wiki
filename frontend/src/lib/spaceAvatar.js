// Generated abstract marks for a space, behind the Generate button in
// SpaceIdentityPicker. The rest of a space's identity — icons, colours, how a
// stored mark is resolved and drawn — lives in `lib/spaceIdentity.js`, which
// this file must never be imported by.
//
// Two rules shape this file.
//
// Generation is local. `@dicebear/core` renders the SVG in the browser, so a
// space never reaches api.dicebear.com — a wiki served from a Frappe site must
// not hand a third party the list of spaces a user is looking at.
//
// Generation is also lazy. The style definitions weigh hundreds of kilobytes
// and the renderer another ~120 kB; that is only ever needed while the picker
// is open. Every entry point here is async and reaches the packages through
// `import()`, so Rollup splits them into chunks the app loads on the first
// roll and never before. Nothing in this module may be imported for its
// side effects.

// The shipped styles: abstract marks only. A space is a thing, not a person,
// so a generated face would read as an owner rather than as the space's own
// mark, and a column of cartoon heads in the sidebar says nothing about the
// wiki. DiceBear's character sets are therefore deliberately not offered.
//
// All four are CC0 1.0 and authored by DiceBear itself, so none carries an
// attribution duty. They are listed one by one rather than pulled wholesale
// from `@dicebear/styles`, which ships 61 of them under licenses we have not
// read — adding one has to stay a deliberate act.
//
// `disco` was dropped for weight, not for looks: it renders ~35 kB of SVG
// against ~4 kB for these four, and a stored mark is fetched once per row by
// the space list. Measure a candidate style's output before adding it.
export const AVATAR_STYLES = [
	{ id: 'glass', label: 'Glass' },
	{ id: 'blobs', label: 'Blobs' },
	{ id: 'waves', label: 'Waves' },
	{ id: 'loops', label: 'Loops' },
];

// One `import()` per style, spelled out. A template literal would work in Vite
// for a relative path but not for a bare package specifier, and listing them is
// what lets Rollup emit one chunk per style instead of a single blob.
const STYLE_LOADERS = {
	blobs: () => import('@dicebear/styles/blobs.json'),
	glass: () => import('@dicebear/styles/glass.json'),
	loops: () => import('@dicebear/styles/loops.json'),
	waves: () => import('@dicebear/styles/waves.json'),
};

// Keyed by style id, holding the in-flight promise rather than the resolved
// style. Two rolls a frame apart then share one download, and `new Style` —
// which validates the definition against a JSON schema — runs once per style
// for the life of the tab instead of once per roll.
const styleCache = new Map();

function loadStyle(id) {
	const cached = styleCache.get(id);
	if (cached) return cached;

	const load = STYLE_LOADERS[id];
	if (!load) return Promise.reject(new Error(`Unknown avatar style: ${id}`));

	const pending = Promise.all([import('@dicebear/core'), load()]).then(
		([{ Style }, definition]) => new Style(definition.default),
	);
	styleCache.set(id, pending);
	return pending;
}

// A roll picks this, and it is stored so the same mark comes back. Random
// rather than derived from the space: a docname would make a roll a no-op, and
// the space name would change the art on every rename.
export function randomAvatarSeed() {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	);
}

export function randomAvatarStyle() {
	const index = Math.floor(Math.random() * AVATAR_STYLES.length);
	return AVATAR_STYLES[index].id;
}

// Render one mark. Returns the SVG as a `data:` URI because that is the form
// both the database and the `<img>` want; `spaceAvatarSrc` in `spaceIdentity`
// is the only thing allowed to hand it to the DOM.
//
// The background is left to the style. Overriding it would mean inventing hex
// colours the design system has no say over — an SVG cannot read a CSS token,
// so any colour baked in here would be the one place in the frontend that owns
// a raw colour value.
export async function renderSpaceAvatar(styleId, seed) {
	const [style, { Avatar }] = await Promise.all([
		loadStyle(styleId),
		import('@dicebear/core'),
	]);
	return new Avatar(style, { seed }).toDataUri();
}

// One roll: a new style and a new seed, and the three fields that let the mark
// be rebuilt later.
export async function rollSpaceAvatar() {
	const style = randomAvatarStyle();
	const seed = randomAvatarSeed();
	return { svg: await renderSpaceAvatar(style, seed), style, seed };
}
