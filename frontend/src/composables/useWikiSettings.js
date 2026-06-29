import { ref } from 'vue';

// Global open-state for the site-wide Wiki Settings dialog, so any component
// (sidebar menu, mobile nav, the GitHub-App return redirect) can open it and
// deep-link to a specific tab. Mirrors CRM's global `showSettings` flag.
const showWikiSettings = ref(false);
const initialTab = ref('general');

export function useWikiSettings() {
	function open(tab = 'general') {
		initialTab.value = tab;
		showWikiSettings.value = true;
	}

	function close() {
		showWikiSettings.value = false;
	}

	return { showWikiSettings, initialTab, open, close };
}
