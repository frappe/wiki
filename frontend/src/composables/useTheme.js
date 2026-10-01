import { useColorScheme, useResolvedColorScheme } from 'frappe-ui';
import { computed } from 'vue';

// Light/dark now comes from frappe-ui's useColorScheme: it owns the
// `data-theme` attribute, the `theme` localStorage key, following the OS while
// the preference is `system`, and muting transitions across a swap so the page
// doesn't flash. That last part used to live here as a hand-rolled two-rAF
// dance plus a `.no-transition` rule in index.css; frappe-ui ships both, and its
// version also cancels a pending unmute so back-to-back swaps can't uncover a
// repaint.

// Carry a preference saved under the old key over to frappe-ui's, once. Both
// surfaces used `wiki-theme` before; without this, everyone who had ever picked
// a theme would silently land back on `system` after the upgrade. Runs before
// the first useColorScheme() call so the restore below sees the migrated value.
if (typeof localStorage !== 'undefined') {
	const legacy = localStorage.getItem('wiki-theme');
	if (legacy && !localStorage.getItem('theme')) {
		localStorage.setItem('theme', legacy);
	}
}

// The painted scheme, which is what a consumer picking a light/dark asset
// actually needs. It is not derivable from the preference alone: `system`
// resolves against the OS, and an OS flip repaints without changing the
// preference. frappe-ui tracks that for us; `useResolvedColorScheme` reads it
// without also owning `data-theme`, which `useColorScheme` below does.
const resolvedTheme = useResolvedColorScheme();

export function useTheme() {
	const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();

	const themeIcon = computed(() =>
		resolvedTheme.value === 'dark' ? 'lucide-sun' : 'lucide-moon',
	);

	return {
		colorScheme,
		resolvedTheme,
		themeIcon,
		setTheme: setColorScheme,
		// frappe-ui's toggle flips the painted scheme, not the preference, so the
		// first click on a system-dark page moves to light instead of looking dead.
		toggleTheme: toggleColorScheme,
	};
}
