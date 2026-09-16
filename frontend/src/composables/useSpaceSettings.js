import { ref } from 'vue';

// Global open-state for the per-space settings dialog. The dialog is mounted by
// SpaceDetails, but it is opened from the sidebar — a sibling, not a child — so
// the flag lives outside both. Mirrors useWikiSettings.
const showSpaceSettings = ref(false);

export function useSpaceSettings() {
	function open() {
		showSpaceSettings.value = true;
	}

	function close() {
		showSpaceSettings.value = false;
	}

	return { showSpaceSettings, open, close };
}
