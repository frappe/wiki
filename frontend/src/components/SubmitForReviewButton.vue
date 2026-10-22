<template>
	<!-- One submit trigger, two placements: the sidebar mode strip and the
	     editor header (spec 02, decision 2). The confirm dialog travels with
	     the button so neither placement depends on the other being mounted. -->
	<Button
		v-if="visible"
		v-bind="$attrs"
		:variant="variant"
		:theme="theme"
		:size="size"
		:loading="crStore.finalizing === 'submitting'"
		:disabled="submitDisabled"
		:title="submitButtonTitle"
		@click="showConfirmDialog = true"
	>
		{{ __('Submit for review') }}
	</Button>

	<!-- Dialog's own title/message/icon/actions, not hand-rolled slots: the
	     component already lays out a confirm, down to the themed icon disc and
	     the action row, and the slot version was a narrower, plainer copy of
	     it. `lg` is the component's default width; `sm` squeezed one sentence
	     onto three lines. -->
	<Dialog
		v-model:open="showConfirmDialog"
		:title="__('Submit for review')"
		:message="confirmMessage"
		icon="lucide-git-branch"
		theme="blue"
		:actions="confirmActions"
	>
		
		<template v-if="needsTitle" #default>
			<div class="space-y-4">
				<p class="text-p-base text-ink-gray-7">{{ confirmMessage }}</p>
				<FormControl
					v-model="newTitle"
					:label="__('Title')"
					type="text"
					:placeholder="__('What did you change?')"
					autofocus
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Button, Dialog, FormControl, toast } from 'frappe-ui';
import { computed, ref, watch } from 'vue';
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
	theme: {
		type: String,
		default: 'gray',
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
const newTitle = ref('');

const GENERATED_TITLE_PREFIX = 'Draft Changes - ';
const needsTitle = computed(() =>
	crStore.currentChangeRequest?.title?.startsWith(GENERATED_TITLE_PREFIX),
);

watch(showConfirmDialog, (open) => {
	if (open) newTitle.value = '';
});

// A submitted or merging change request has nothing left to submit.
const visible = computed(() => {
	if (!spaceStore.isEditing) return false;
	if (crStore.finalizing) return crStore.finalizing === 'submitting';
	// Autosave waits for a pause before typing becomes a change row. Counting an
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
	if (draftStore.finalizationBlocker === 'uploading') {
		return __('Wait for uploads to finish before submitting');
	}
	if (draftStore.finalizationBlocker === 'upload-failed') {
		return __('Remove failed uploads before submitting');
	}
	if (draftStore.finalizationBlocker === 'pending') {
		return __('Wait for pending changes to sync before submitting');
	}
	return '';
});

// The count is the whole point of the confirmation: what is about to leave
// your hands. Phrased as the consequence rather than "are you sure", which
// asks the user to re-derive it.
const confirmMessage = computed(() =>
	__('{0} pending {1} will be sent for review.', [
		crStore.changeCount,
		crStore.changeCount === 1 ? __('change') : __('changes'),
	]),
);

const confirmActions = computed(() => [
	{
		label: __('Cancel'),
		variant: 'outline',
		onClick: ({ close }) => close(),
	},
	{
		label: __('Submit'),
		variant: 'solid',
		loading: crStore.isSubmitting,
		disabled: needsTitle.value && !newTitle.value.trim(),
		onClick: ({ close }) => confirmSubmit(close),
	},
]);

async function confirmSubmit(closeDialog) {
	if (needsTitle.value) {
		try {
			await crStore.updateChangeRequest({ title: newTitle.value.trim() });
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error updating title'));
			return;
		}
	}
	closeDialog();
	crActions.submitForReview();
}
</script>
