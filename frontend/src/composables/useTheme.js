import { useStorage } from '@vueuse/core';
import { computed } from 'vue';

// Module-level so desktop Sidebar and mobile top nav share one theme value.
const userTheme = useStorage('wiki-theme', 'dark');

// Suppress transitions for the swap itself: without this, every element with a
// colour transition animates independently and the page flashes on its way to
// the new theme. Two rAFs so the class survives the style + paint of the swap.
function applyTheme(theme) {
	const root = document.documentElement;
	root.classList.add('no-transition');
	root.setAttribute('data-theme', theme);
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			root.classList.remove('no-transition');
		});
	});
}

export function useTheme() {
	const themeIcon = computed(() =>
		userTheme.value === 'dark' ? 'lucide-sun' : 'lucide-moon',
	);

	function toggleTheme() {
		const next = userTheme.value === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		userTheme.value = next;
	}

	// Reflect the stored theme onto <html> once the mounting shell appears.
	function initTheme() {
		applyTheme(userTheme.value);
	}

	return { userTheme, themeIcon, toggleTheme, initTheme };
}
