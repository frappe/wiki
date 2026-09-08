import { ref } from 'vue';

// Module-scoped rather than per-editor: the editor component is torn down and
// rebuilt whenever the route leaves the page (a draft, another space), and
// whether the settings panel is open is a preference about the workspace, not
// a property of whichever page happens to be on screen.
const isOpen = ref(false);

export function usePageSettingsPanel() {
	function open() {
		isOpen.value = true;
	}

	function close() {
		isOpen.value = false;
	}

	function toggle() {
		isOpen.value = !isOpen.value;
	}

	return { isOpen, open, close, toggle };
}
