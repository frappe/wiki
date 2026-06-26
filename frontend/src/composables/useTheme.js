import { useStorage } from '@vueuse/core';
import { computed } from 'vue';
import LucideMoon from '~icons/lucide/moon';
import LucideSun from '~icons/lucide/sun';

// Module-level so desktop Sidebar and mobile top nav share one theme value.
const userTheme = useStorage('wiki-theme', 'dark');

function applyTheme(theme) {
	document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
	const themeIcon = computed(() =>
		userTheme.value === 'dark' ? LucideSun : LucideMoon,
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
