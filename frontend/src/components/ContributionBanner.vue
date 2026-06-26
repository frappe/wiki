<template>
	<div
		v-if="crStore.isChangeRequestMode"
		class="contribution-banner px-3 py-3 sm:px-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
		:class="bannerClass"
	>
		<div class="flex items-center gap-3 min-w-0">
			<component :is="bannerIcon" class="size-5 shrink-0" />
			<div class="min-w-0">
				<p class="text-sm font-medium">{{ bannerTitle }}</p>
				<p class="text-xs opacity-80">{{ bannerDescription }}</p>
			</div>
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<Badge
				v-if="syncStateLabel"
				variant="subtle"
				:theme="syncStateTheme"
				size="md"
				:title="syncStateTitle"
			>
				{{ syncStateLabel }}
			</Badge>

			<Button
				v-if="showReloadLatest"
				variant="outline"
				size="sm"
				:loading="reloading"
				:title="__('Discard local failed changes and adopt server state')"
				@click="onReloadLatest"
			>
				{{ __('Reload latest') }}
			</Button>

			<template v-if="changeRequestStatus === 'Draft' || changeRequestStatus === 'Changes Requested'">
				<Button
					v-if="canShowMerge"
					size="sm"
					:loading="crStore.isMerging"
					:disabled="mergeDisabledComputed"
					:title="mergeButtonTitle"
					@click="$emit('merge')"
				>
					{{ __('Merge') }}
				</Button>
				<Button
					v-if="crStore.changeCount > 0"
					size="sm"
					:loading="crStore.isSubmitting"
					:disabled="submitDisabled"
					:title="submitButtonTitle"
					@click="showSubmitConfirmDialog = true"
				>
					{{ __('Submit for Review') }}
				</Button>
			</template>

			<template v-else-if="changeRequestStatus === 'Approved'">
				<span class="text-sm font-medium text-green-700">
					{{ __('Approved! Ready to merge.') }}
				</span>
				<Button
					v-if="canShowMerge"
					size="sm"
					:loading="crStore.isMerging"
					:disabled="mergeDisabledComputed"
					:title="mergeButtonTitle"
					@click="$emit('merge')"
				>
					{{ __('Merge') }}
				</Button>
			</template>

			<Dropdown v-if="menuOptions.length > 0" :options="menuOptions">
				<Button variant="outline" size="sm" :title="__('More actions')">
					<LucideMoreVertical class="size-4" />
				</Button>
			</Dropdown>
		</div>

		<Dialog v-model="showChangesDialog" :options="{ size: 'lg' }">
			<template #body-title>
				<div class="flex items-center gap-2">
					<LucideGitBranch class="size-5 text-ink-gray-5" />
					<h3 class="text-xl font-semibold text-ink-gray-9">
						{{ __('Pending Changes') }}
					</h3>
				</div>
			</template>
			<template #body-content>
				<div class="space-y-3 max-h-[60vh] overflow-y-auto">
					<div
						v-for="change in crStore.changes"
						:key="change.doc_key"
						class="flex items-start gap-3 p-3 rounded-lg border border-outline-gray-2 hover:bg-surface-gray-1"
					>
						<div
							class="flex items-center justify-center size-8 rounded-full shrink-0"
							:class="getChangeIconClass(change.change_type)"
						>
							<component :is="getChangeIcon(change.change_type)" class="size-4" />
						</div>

						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium text-ink-gray-9 truncate">
									{{ change.title || __('Untitled') }}
								</span>
								<Badge variant="subtle" :theme="getChangeTheme(change.change_type)" size="sm">
									{{ getChangeLabel(change.change_type) }}
								</Badge>
							</div>
							<p class="text-sm text-ink-gray-5 mt-0.5">
								{{ getChangeDescription(change.change_type, change.is_group, change.is_external_link) }}
							</p>
							<p v-if="change.is_external_link && change.external_url" class="text-sm text-ink-gray-5 mt-0.5 truncate">
								<a :href="change.external_url" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">
									{{ change.external_url }}
								</a>
							</p>
						</div>

						<div class="flex items-center gap-1 text-ink-gray-4 shrink-0">
							<LucideFolder v-if="change.is_group" class="size-4" />
							<LucideLink v-else-if="change.is_external_link" class="size-4" />
							<LucideFileText v-else class="size-4" />
						</div>
					</div>

					<div v-if="crStore.changes.length === 0" class="text-center py-8 text-ink-gray-5">
						{{ __('No pending changes') }}
					</div>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end">
					<Button variant="outline" @click="close">{{ __('Close') }}</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showSubmitConfirmDialog" :options="{ size: 'sm' }">
			<template #body-title>
				<div class="flex items-center gap-2">
					<LucideGitBranch class="size-5 text-ink-gray-5" />
					<h3 class="text-xl font-semibold text-ink-gray-9">
						{{ __('Submit for Review') }}
					</h3>
				</div>
			</template>
			<template #body-content>
				<p class="text-ink-gray-7">
					{{ __('Are you sure you want to submit your changes for review?') }}
				</p>
				<p class="text-sm text-ink-gray-5 mt-2">
					{{ __('You have {0} pending {1}.', [crStore.changeCount, crStore.changeCount === 1 ? __('change') : __('changes')]) }}
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
	</div>
</template>

<script setup>
import { useChangeTypeDisplay } from '@/composables/useChangeTypeDisplay';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useUserStore } from '@/stores/user';
import { Badge, Button, Dialog, Dropdown, toast } from 'frappe-ui';
import { computed, ref } from 'vue';
import LucideAlertCircle from '~icons/lucide/alert-circle';
import LucideCheckCircle from '~icons/lucide/check-circle';
import LucideClock from '~icons/lucide/clock';
import LucideFileText from '~icons/lucide/file-text';
import LucideFolder from '~icons/lucide/folder';
import LucideGitBranch from '~icons/lucide/git-branch';
import LucideLink from '~icons/lucide/link';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucideXCircle from '~icons/lucide/x-circle';

const {
	getChangeIcon,
	getChangeIconClass,
	getChangeTheme,
	getChangeLabel,
	getChangeDescription,
} = useChangeTypeDisplay();
const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const userStore = useUserStore();

// Submit / merge are blocked while local mutations are still syncing or
// failed — submitting a stale backend CR would silently drop the user's
// in-flight edits. Unsaved editor content (debounced autosave hasn't fired
// yet) also counts: without this guard a user could type and submit
// within the 10s autosave window, sending the previous content. Reorder
// counts as pending too via mergeDisabled.
const hasUnsyncedWork = computed(() => Boolean(draftStore.finalizationBlocker));
const submitDisabled = computed(() => hasUnsyncedWork.value);
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
	if (draftStore.finalizationBlocker === 'unsaved') {
		return __('Save your changes before submitting');
	}
	return '';
});

// Durable sync indicator. Replaces per-edit success toasts: while the
// store is mid-flight or has failures, this pill is the source of truth.
// "Unsaved changes" is a distinct state from "Saving…" — the latter
// implies an in-flight RPC, while the former covers the autosave
// debounce window where no save has even started. Conflating them
// reads as dishonest UI per specs/local_first_editor_migration_step_1.md.
const syncStateLabel = computed(() => {
	if (draftStore.hasFailedMutations || draftStore.sync.status === 'failed') {
		return __('Sync failed');
	}
	if (draftStore.hasPendingMutations || draftStore.sync.status === 'saving') {
		return __('Saving…');
	}
	if (draftStore.hasUnsavedEditorContent) {
		return __('Unsaved changes');
	}
	if (draftStore.sync.lastSavedAt) {
		return __('All changes saved');
	}
	return '';
});
const syncStateTheme = computed(() => {
	if (draftStore.hasFailedMutations || draftStore.sync.status === 'failed') {
		return 'red';
	}
	if (draftStore.hasPendingMutations || draftStore.sync.status === 'saving') {
		return 'orange';
	}
	if (draftStore.hasUnsavedEditorContent) {
		return 'gray';
	}
	return 'green';
});
const syncStateTitle = computed(() => {
	if (draftStore.sync.error) return draftStore.sync.error;
	const failed = draftStore.pending.find((m) => m.status === 'failed');
	if (failed?.error) return failed.error;
	return '';
});

// `Reload latest` is the first-line recovery for conflicts and sync
// failures (specs/local_first_editor_migration_step_2.md). It appears
// only when there is something to recover from — otherwise the action
// would be a noisy noop next to a healthy sync pill.
const showReloadLatest = computed(
	() =>
		draftStore.sync.conflict ||
		draftStore.hasFailedMutations ||
		draftStore.sync.status === 'failed',
);
const reloading = ref(false);
async function onReloadLatest() {
	reloading.value = true;
	try {
		await draftStore.reloadFromServer();
	} catch (error) {
		toast.error(
			error.messages?.[0] || error.message || __('Could not reload from server'),
		);
	} finally {
		reloading.value = false;
	}
}

const props = defineProps({
	mergeDisabled: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['submit', 'withdraw', 'merge']);

const changeRequestStatus = computed(
	() => crStore.currentChangeRequest?.status || 'Draft',
);

const showChangesDialog = ref(false);
const showSubmitConfirmDialog = ref(false);

function confirmSubmit(closeDialog) {
	closeDialog();
	emit('submit');
}

const canShowMerge = computed(() => {
	return userStore.isWikiManager && crStore.changeCount > 0;
});

const mergeButtonTitle = computed(() => {
	if (draftStore.finalizationBlocker === 'conflict') {
		return __('Reload latest before merging');
	}
	if (draftStore.finalizationBlocker === 'failed') {
		return __('Resolve failed changes before merging');
	}
	if (draftStore.finalizationBlocker === 'pending') {
		return __('Wait for pending changes to sync before merging');
	}
	if (draftStore.finalizationBlocker === 'unsaved') {
		return __('Save your changes before merging');
	}
	if (props.mergeDisabled) {
		return __('Please wait for reordering to finish before merging');
	}
	return '';
});

const mergeDisabledComputed = computed(
	() => props.mergeDisabled || hasUnsyncedWork.value,
);

const canShowArchive = computed(() => {
	return (
		crStore.changeCount > 0 &&
		(changeRequestStatus.value === 'Draft' ||
			changeRequestStatus.value === 'In Review' ||
			changeRequestStatus.value === 'Changes Requested')
	);
});

const menuOptions = computed(() => {
	const options = [];
	if (crStore.changeCount > 0) {
		options.push({
			label: __('View changes ({0})', [crStore.changeCount]),
			icon: 'list',
			onClick: () => {
				showChangesDialog.value = true;
			},
		});
	}
	if (canShowArchive.value) {
		options.push({
			label: __('Discard Changes'),
			icon: 'archive',
			onClick: () => emit('withdraw'),
		});
	}
	return options;
});

const BANNER_CONFIG = {
	Draft: {
		class: 'bg-gray-50 border-b border-gray-200 text-gray-800',
		icon: LucideGitBranch,
		title: __('Change Request Draft'),
		description: __('Your changes are saved as a draft change request'),
	},
	'In Review': {
		class: 'bg-amber-50 border-b border-amber-200 text-amber-800',
		icon: LucideClock,
		title: __('In Review'),
		description: __('Your change request is being reviewed'),
	},
	'Changes Requested': {
		class: 'bg-red-50 border-b border-red-200 text-red-800',
		icon: LucideXCircle,
		title: __('Changes Requested'),
		description: __('Please review the feedback and update your changes'),
	},
	Approved: {
		class: 'bg-green-50 border-b border-green-200 text-green-800',
		icon: LucideCheckCircle,
		title: __('Approved'),
		description: __('Approved and ready to merge'),
	},
	Merged: {
		class: 'bg-green-50 border-b border-green-200 text-green-800',
		icon: LucideCheckCircle,
		title: __('Merged'),
		description: __('Your changes have been merged'),
	},
	Rejected: {
		class: 'bg-red-50 border-b border-red-200 text-red-800',
		icon: LucideXCircle,
		title: __('Rejected'),
		description: __('This change request was rejected and will not be merged'),
	},
};

const DEFAULT_BANNER = {
	class: 'bg-gray-50 border-b border-gray-200 text-gray-800',
	icon: LucideAlertCircle,
	title: __('Change Request'),
	description: '',
};

const bannerConfig = computed(
	() => BANNER_CONFIG[changeRequestStatus.value] || DEFAULT_BANNER,
);
const bannerClass = computed(() => bannerConfig.value.class);
const bannerIcon = computed(() => bannerConfig.value.icon);
const bannerTitle = computed(() => bannerConfig.value.title);

// On Changes Requested / Rejected, show the reviewer's actual feedback instead
// of a generic prompt — this is the only place the author sees why their CR
// bounced back (the comment is stored on the CR by `request_changes` /
// `reject_change_request`).
const bannerDescription = computed(() => {
	const cr = crStore.currentChangeRequest;
	const showsReviewComment = ['Changes Requested', 'Rejected'].includes(
		changeRequestStatus.value,
	);
	if (showsReviewComment && cr?.review_comment) {
		return cr.reviewed_by
			? __('{0} — {1}', [cr.review_comment, cr.reviewed_by])
			: cr.review_comment;
	}
	return bannerConfig.value.description;
});
</script>
