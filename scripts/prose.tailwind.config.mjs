// Tailwind v3 config used ONLY by generate-public-prose.mjs to emit the
// `.prose` / `.prose-v3` component rules the SPA editor gets, for reuse by
// the public reader's Tailwind v4 pipeline. Explicit path into
// frontend/node_modules — the repo root has no frappe-ui install, and the
// v3 CLI's jiti loader is what makes the preset's ESM/JSON imports loadable.
import preset from '../frontend/node_modules/frappe-ui/tailwind/index.js';

export default {
	presets: [preset],
	// No sources to scan — everything we want is safelisted.
	content: [],
	safelist: ['prose', 'prose-v3'],
	corePlugins: { preflight: false },
};
