<template>
	<!-- For small fixes by someone who could approve them anyway: submit,
	     approve and merge in one go. The change request still exists, so
	     history shows it like any other merge. -->
	<Button
		v-if="visible"
		variant="outline"
		:loading="crStore.finalizing === 'merging'"
		:disabled="disabled"
		:title="disabledReason"
		@click="crActions.mergeChangeRequest"
	>
		{{ __('Merge') }}
	</Button>
</template>

<script setup>
import { Button } from 'frappe-ui';
import { computed } from 'vue';
import { useChangeRequestActions } from '../composables/useChangeRequestActions';
import { useChangeRequestStore } from '../stores/changeRequest';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';

const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const crActions = useChangeRequestActions();

const visible = computed(() => {
	if (!spaceStore.isEditing || !spaceStore.canWriteSpace) return false;
	if (crStore.finalizing) return crStore.finalizing === 'merging';
	return crStore.changeCount > 0 || draftStore.hasUnsavedEditorContent;
});

// An unsaved buffer is not a blocker: the action flushes it first.
const blocker = computed(() => {
	const reason = draftStore.finalizationBlocker;
	return reason === 'unsaved' ? null : reason;
});

const disabled = computed(() =>
	Boolean(crStore.finalizing || blocker.value || spaceStore.isTreeReordering),
);

const disabledReason = computed(() => {
	if (blocker.value === 'conflict') return __('Reload latest before merging');
	if (blocker.value === 'failed') {
		return __('Resolve failed changes before merging');
	}
	if (blocker.value === 'uploading') {
		return __('Wait for uploads to finish before merging');
	}
	if (blocker.value === 'upload-failed') {
		return __('Remove failed uploads before merging');
	}
	if (blocker.value === 'pending') {
		return __('Wait for pending changes to sync before merging');
	}
	if (spaceStore.isTreeReordering) {
		return __('Please wait for reordering to finish before merging');
	}
	return '';
});
</script>
