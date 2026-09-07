import { ref } from 'vue';

// Module-scoped for the same reason usePageSettingsPanel is: the button that
// asks for a new page (the content column's empty state) and the dialog that
// makes one (the tree, in the sidebar) sit in different columns, and neither is
// an ancestor of the other.
//
// A pending flag rather than an event, because on mobile the tree lives in a
// drawer that unmounts while closed — the dialog's owner is not there to hear
// an event at the moment the button is pressed. The flag survives until
// whoever can act on it mounts and consumes it.
const pending = ref(false);

export function useNewPageRequest() {
	function requestNewPage() {
		pending.value = true;
	}

	// Consumed once: a second tree mounting later must not reopen the dialog.
	function consumeNewPageRequest() {
		if (!pending.value) return false;
		pending.value = false;
		return true;
	}

	return { pending, requestNewPage, consumeNewPageRequest };
}
