<template>
	<!-- One submit trigger, two placements: the sidebar mode strip and the
	     editor header (spec 02, decision 2). The confirm dialog travels with
	     the button so neither placement depends on the other being mounted. -->
	<Button
		v-if="visible"
		v-bind="$attrs"
		:variant="variant"
		:size="size"
		:loading="crStore.isSubmitting"
		:disabled="submitDisabled"
		:title="submitButtonTitle"
		@click="showConfirmDialog = true"
	>
		{{ __('Submit for Review') }}
	</Button>

	<Dialog v-model:open="showConfirmDialog" size="sm">
		<template #title>
			<div class="flex items-center gap-2">
				<span
					class="lucide-git-branch size-5 text-ink-gray-5"
					aria-hidden="true"
				/>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Submit for Review') }}
				</h3>
			</div>
		</template>
		<template #default>
			<p class="text-ink-gray-7">
				{{ __('Are you sure you want to submit your changes for review?') }}
			</p>
			<p class="text-sm text-ink-gray-5 mt-2">
				{{
					__('You have {0} pending {1}.', [
						crStore.changeCount,
						crStore.changeCount === 1 ? __('change') : __('changes'),
					])
				}}
			</p>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end gap-2">
				<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
				<Button
					variant="solid"
					:loading="crStore.isSubmitting"
					@click="confirmSubmit(close)"
				>
					{{ __('Submit') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Button, Dialog } from 'frappe-ui';
import { computed, ref } from 'vue';
import { useChangeRequestActions } from '../composables/useChangeRequestActions';
import { useChangeRequestStore } from '../stores/changeRequest';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';

defineOptions({ inheritAttrs: false });

defineProps({
	variant: {
		type: String,
		default: 'solid',
	},
	size: {
		type: String,
		default: 'md',
	},
});

const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const crActions = useChangeRequestActions();

const showConfirmDialog = ref(false);

// A submitted or merging change request has nothing left to submit, and a
// synced space never opens one at all.
const visible = computed(() => {
	if (spaceStore.isGitSynced) return false;
	if (!crStore.isChangeRequestMode) return false;
	if (crStore.finalizing) return false;
	// Autosave takes ten seconds to turn typing into a change row. Counting an
	// unsaved buffer as submittable work keeps the button from disappearing in
	// that window — there is no Save button left to fill it.
	if (crStore.changeCount === 0 && !draftStore.hasUnsavedEditorContent) {
		return false;
	}
	const status = crStore.currentChangeRequest?.status || 'Draft';
	return status === 'Draft' || status === 'Changes Requested';
});

// Submitting is blocked while local mutations are still syncing or failed:
// a stale backend CR would silently drop the user's in-flight edits.
// An unsaved editor buffer is not a blocker: the action flushes it first.
const submitDisabled = computed(() => {
	const blocker = draftStore.finalizationBlocker;
	return Boolean(blocker) && blocker !== 'unsaved';
});

const submitButtonTitle = computed(() => {
	if (draftStore.finalizationBlocker === 'conflict') {
		return __('Reload latest before submitting');
	}
	if (draftStore.finalizationBlocker === 'failed') {
		return __('Resolve failed changes before submitting');
	}
	if (draftStore.finalizationBlocker === 'pending') {
		return __('Wait for pending changes to sync before submitting');
	}
	return '';
});

function confirmSubmit(closeDialog) {
	closeDialog();
	crActions.submitForReview();
}
</script>
