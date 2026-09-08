import { computed } from 'vue';

import { useDraftWorkspaceStore } from '../stores/draftWorkspace';

/**
 * The draft workspace's sync state, as one line of text plus a theme.
 *
 * Lifted out of SpaceModeStrip so the same state can be rendered from more
 * than one place in the sidebar while we settle where it belongs.
 *
 * "Unsaved changes" is a distinct state from "Saving…" — the latter implies an
 * in-flight RPC, while the former covers the autosave debounce window where no
 * save has even started. Conflating them reads as dishonest UI per
 * specs/local_first_editor_migration_step_1.md.
 *
 * A settled draft says nothing at all: "All changes saved" is the state the
 * user already assumes, and a permanent pill under the change request is one
 * more thing to read every time they look at the sidebar.
 */
export function useSyncState() {
	const draftStore = useDraftWorkspaceStore();

	const failed = computed(
		() => draftStore.hasFailedMutations || draftStore.sync.status === 'failed',
	);
	const saving = computed(
		() => draftStore.hasPendingMutations || draftStore.sync.status === 'saving',
	);

	const label = computed(() => {
		if (failed.value) return __('Sync failed');
		if (saving.value) return __('Saving…');
		if (draftStore.hasUnsavedEditorContent) return __('Unsaved changes');
		return '';
	});

	const theme = computed(() => {
		if (failed.value) return 'red';
		if (saving.value) return 'amber';
		return 'gray';
	});

	// The store's own words for what went wrong, shown rather than parked in a
	// `title` attribute nobody hovers.
	const description = computed(() => {
		if (draftStore.sync.error) return draftStore.sync.error;
		const failedMutation = draftStore.pending.find(
			(m) => m.status === 'failed',
		);
		return failedMutation?.error || '';
	});

	return { label, theme, description };
}
