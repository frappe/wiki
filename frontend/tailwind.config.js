import frappeUIPreset, { content as frappeUIContent } from 'frappe-ui/tailwind';

export default {
	presets: [frappeUIPreset],
	// Tailwind v3 doesn't merge a preset's `content`, so frappe-ui's globs have
	// to be listed here. `frappeUIContent` is the package's own list — the
	// hand-written paths it replaces had already drifted and were dropping every
	// class the editor and list molecules emit.
	content: [
		'./index.html',
		'./src/**/*.{vue,js,ts,jsx,tsx}',
		...frappeUIContent,
	],
	theme: {
		extend: {},
	},
	plugins: [],
};
