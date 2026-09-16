import { resolvedColorScheme, useColorScheme } from 'frappe-ui';
import { computed, ref } from 'vue';

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
// preference, so there is nothing reactive to watch. Track the attribute
// frappe-ui writes instead. Module-level so every caller shares one observer.
const resolvedTheme = ref(resolvedColorScheme());

if (typeof document !== 'undefined') {
	new MutationObserver(() => {
		resolvedTheme.value = resolvedColorScheme();
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme'],
	});
}

export function useTheme() {
	const { colorScheme, setColorScheme } = useColorScheme();

	const themeIcon = computed(() =>
		resolvedTheme.value === 'dark' ? 'lucide-sun' : 'lucide-moon',
	);

	// Not frappe-ui's toggleColorScheme: that one branches on the preference, so
	// the first click while the preference is `system` picks `dark` — which is
	// what a system-dark page is already painted in, and the click looks dead.
	// Flipping the painted scheme always changes something.
	function toggleTheme() {
		setColorScheme(resolvedTheme.value === 'dark' ? 'light' : 'dark');
	}

	return {
		colorScheme,
		resolvedTheme,
		themeIcon,
		setTheme: setColorScheme,
		toggleTheme,
	};
}
