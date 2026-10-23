import { ref } from 'vue';

// Module-scoped rather than per-editor: the editor component is torn down and
// rebuilt whenever the route leaves the page (a draft, another space), and
// which panel is open is a preference about the workspace, not a property of
// whichever page happens to be on screen.
const openPanel = ref(null);

// The panels beside the page share one slot, one at a time.
export function useSidePanel() {
	function toggle(name) {
		openPanel.value = openPanel.value === name ? null : name;
	}

	function open(name) {
		openPanel.value = name;
	}

	function close() {
		openPanel.value = null;
	}

	return { openPanel, toggle, open, close };
}
