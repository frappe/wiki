<template>
	<!-- The mode strip sits directly under the space header in the sidebar. A
	     git-synced space and a space with an open draft are read and edited in
	     different ways, and the strip says which one you are in before you click
	     anything. The two states are mutually exclusive: a synced space never
	     opens a change request. -->
	<div v-if="spaceStore.isGitSynced" class="shrink-0 px-2 pt-2">
		<div
			class="flex items-center gap-1.5 rounded-4 bg-surface-gray-2 px-2 py-1.5"
		>
			<a
				v-if="spaceStore.doc?.repo_full_name"
				:href="`https://github.com/${spaceStore.doc.repo_full_name}`"
				target="_blank"
				rel="noopener noreferrer"
				class="flex min-w-0 flex-1 items-center gap-1.5 text-ink-gray-7 hover:text-ink-gray-8"
				:title="spaceStore.doc.repo_full_name"
			>
				<span
					class="lucide-folder-git-2 size-3.5 shrink-0"
					aria-hidden="true"
				/>
				<!-- Owner dropped, branch kept: 260px minus the badge and the sync
				     button leaves no room for both, and the branch is the part that
				     changes. The link's title carries the full name. -->
				<span class="truncate text-xs">
					{{ repoShortName
					}}<span v-if="spaceStore.doc?.branch"
						>@{{ spaceStore.doc.branch }}</span
					>
				</span>
			</a>
			<span v-else class="min-w-0 flex-1 truncate text-xs text-ink-gray-7">
				{{ __('Synced from GitHub') }}
			</span>
			<Badge size="sm" variant="subtle" :theme="syncStatusTheme">
				{{ spaceStore.syncStatusLabel(spaceStore.doc?.last_sync_status) }}
			</Badge>
			<Button
				variant="ghost"
				size="sm"
				icon="lucide-refresh-cw"
				:label="__('Sync now')"
				:loading="spaceStore.syncing"
				@click="() => spaceStore.syncNow()"
			/>
		</div>
		<p class="px-2 py-2 text-xs text-ink-gray-5">{{ syncedLine }}</p>
	</div>

	<div
		v-else-if="crStore.isChangeRequestMode"
		class="contribution-strip shrink-0 px-2 pt-2"
	>
		<!-- 260px does not fit a label and two buttons on one line, so the meta
		     line and the actions stack. -->
		<div class="rounded-4 px-2 py-2" :class="stripClass">
			<div class="flex items-start gap-1.5">
				<!-- The card's own tint carries the status, so a subtle badge on top
				     of it would be one grey box inside another. -->
				<span class="min-w-0 flex-1 truncate text-xs-medium">
					{{ stripTitle }}
				</span>
				<Dropdown
					v-if="menuOptions.length > 0"
					:options="menuOptions"
					placement="right"
				>
					<Button
						variant="ghost"
						size="sm"
						icon="lucide-more-horizontal"
						:label="__('More actions')"
					/>
				</Dropdown>
			</div>

			<p v-if="changeCountLabel" class="mt-1 truncate text-xs text-ink-gray-6">
				{{ changeCountLabel }}
			</p>

			<p
				v-if="reviewFeedback"
				class="mt-1 text-xs text-ink-red-7"
				:title="reviewFeedback"
			>
				{{ reviewFeedback }}
			</p>

			<!-- Only the mobile strip carries the sync notice. On desktop it
			     floats over the sidebar tree instead: in flow here it shoves the
			     whole tree down every time it appears. Mobile has no sidebar to
			     float in, and the strip sits above the content anyway. -->
			<SyncStateAlert v-if="showSyncState" class="mt-2" />

			<Button
				v-if="showReloadLatest"
				class="mt-2 w-full"
				variant="outline"
				size="sm"
				:loading="reloading"
				:title="__('Discard local failed changes and adopt server state')"
				@click="onReloadLatest"
			>
				{{ __('Reload latest') }}
			</Button>

			<!-- One stable button for the whole merge/withdraw round trip. The
			     status branches below churn through In Review and Approved on the
			     way, and the summary they read belongs to a change request that is
			     being retired.

			     Outline, not subtle: a subtle gray button is drawn on
			     surface-gray-2, which is this card's own tint in the Draft state,
			     so it vanished into it. Outline puts it on surface-base, which
			     reads off the card without taking solid — the page header's
			     Submit for review is the one primary action on this screen. -->
			<template v-if="crStore.finalizing">
				<Button class="mt-2 w-full" variant="outline" size="sm" loading disabled>
					{{
						crStore.finalizing === 'withdrawing' ? __('Discard') : __('Merge')
					}}
				</Button>
			</template>

			<template
				v-else-if="
					changeRequestStatus === 'Draft' ||
					changeRequestStatus === 'Changes Requested'
				"
			>
				<Button
					v-if="canShowMerge"
					class="mt-2 w-full"
					variant="outline"
					size="sm"
					:loading="crStore.isMerging"
					:disabled="mergeDisabled"
					:title="mergeButtonTitle"
					@click="crActions.mergeChangeRequest"
				>
					{{ __('Merge') }}
				</Button>
			</template>

			<template v-else-if="changeRequestStatus === 'Approved'">
				<p class="mt-1 text-xs-medium text-ink-green-6">
					{{ __('Approved! Ready to merge.') }}
				</p>
				<Button
					v-if="canShowMerge"
					class="mt-2 w-full"
					variant="outline"
					size="sm"
					:loading="crStore.isMerging"
					:disabled="mergeDisabled"
					:title="mergeButtonTitle"
					@click="crActions.mergeChangeRequest"
				>
					{{ __('Merge') }}
				</Button>
			</template>
		</div>
	</div>

	<Dialog v-model:open="showChangesDialog" size="lg">
		<template #title>
			<div class="flex items-center gap-2">
				<span
					class="lucide-git-branch size-5 text-ink-gray-5"
					aria-hidden="true"
				/>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Pending Changes') }}
				</h3>
			</div>
		</template>
		<template #default>
			<div class="space-y-3 max-h-[60vh] overflow-y-auto">
				<div
					v-for="change in crStore.changes"
					:key="change.doc_key"
					class="flex items-start gap-3 p-3 rounded-6 border border-outline-gray-2 hover:bg-surface-gray-1"
				>
					<div
						class="flex items-center justify-center size-8 rounded-full shrink-0"
						:class="getChangeIconClass(change.change_type)"
					>
						<span
							:class="getChangeIcon(change.change_type)"
							class="size-4"
							aria-hidden="true"
						/>
					</div>

					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="font-medium text-ink-gray-9 truncate">
								{{ change.title || __('Untitled') }}
							</span>
							<Badge
								variant="subtle"
								:theme="getChangeTheme(change.change_type)"
								size="sm"
							>
								{{ getChangeLabel(change.change_type) }}
							</Badge>
						</div>
						<p class="text-sm text-ink-gray-5 mt-0.5">
							{{
								getChangeDescription(
									change.change_type,
									change.is_group,
									change.is_external_link,
								)
							}}
						</p>
						<p
							v-if="change.is_external_link && change.external_url"
							class="text-sm text-ink-gray-5 mt-0.5 truncate"
						>
							<a
								:href="change.external_url"
								target="_blank"
								rel="noopener noreferrer"
								class="text-ink-blue-link hover:underline"
							>
								{{ change.external_url }}
							</a>
						</p>
					</div>

					<div class="flex items-center gap-1 text-ink-gray-4 shrink-0">
						<span
							v-if="change.is_group"
							class="lucide-folder size-4"
							aria-hidden="true"
						/>
						<span
							v-else-if="change.is_external_link"
							class="lucide-link size-4"
							aria-hidden="true"
						/>
						<span v-else class="lucide-file-text size-4" aria-hidden="true" />
					</div>
				</div>

				<div
					v-if="crStore.changes.length === 0"
					class="text-center py-8 text-ink-gray-5"
				>
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

</template>

<script setup>
import { Badge, Button, Dialog, Dropdown, dayjsLocal, toast } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

import { useChangeRequestActions } from '../composables/useChangeRequestActions';
import { useChangeTypeDisplay } from '../composables/useChangeTypeDisplay';
// TEMPORARY — remove with SyncAlertPlacementSwitcher.
import { useChangeRequestStore } from '../stores/changeRequest';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';
import { useUserStore } from '../stores/user';
import SyncStateAlert from './SyncStateAlert.vue';

defineProps({
	// The mobile strip renders inline above the content and is the only place
	// the sync notice has to live there; the desktop sidebar floats its own.
	showSyncState: { type: Boolean, default: false },
});

const {
	getChangeIcon,
	getChangeIconClass,
	getChangeTheme,
	getChangeLabel,
	getChangeDescription,
} = useChangeTypeDisplay();
const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const userStore = useUserStore();
const crActions = useChangeRequestActions();

// `owner/repo` — only the repo half survives the sidebar's width.
const repoShortName = computed(() => {
	const full = spaceStore.doc?.repo_full_name || '';
	return full.split('/').pop() || full;
});

const SYNC_STATUS_THEME = {
	Success: 'green',
	Error: 'red',
	Partial: 'amber',
};
const syncStatusTheme = computed(
	() => SYNC_STATUS_THEME[spaceStore.doc?.last_sync_status] || 'gray',
);

// How stale the space is, and nothing else. That it is read-only is the page
// header's to say, on the page you would have edited — saying it here too put
// the same word twice on one screen, in the place with the least room for it.
const syncedLine = computed(() => {
	const lastSync = spaceStore.doc?.last_sync_time;
	if (!lastSync) return __('Never synced');
	return __('Last synced {0}', [dayjsLocal(lastSync).fromNow()]);
});

// Submit / merge are blocked while local mutations are still syncing or
// failed — submitting a stale backend CR would silently drop the user's
// in-flight edits. Unsaved editor content (debounced autosave hasn't fired
// yet) also counts: without this guard a user could type and submit
// within the 10s autosave window, sending the previous content. Reorder
// counts as pending too via isTreeReordering.
const hasUnsyncedWork = computed(() => Boolean(draftStore.finalizationBlocker));
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
			error.messages?.[0] ||
				error.message ||
				__('Could not reload from server'),
		);
	} finally {
		reloading.value = false;
	}
}

// Frozen while the CR is being finalized: the server walks it through In Review
// and Approved on the way to a merge, and every one of those states is a badge,
// a strip colour and a different action row. The user asked for one thing, so
// they see one state until it lands.
const changeRequestStatus = computed(() => {
	if (crStore.finalizing) return finalizingStatus.value;
	return crStore.currentChangeRequest?.status || 'Draft';
});

// The status as it was when finalizing began, held for the duration.
const finalizingStatus = ref('Draft');
watch(
	() => crStore.finalizing,
	(state, previous) => {
		if (state && !previous) {
			finalizingStatus.value = crStore.currentChangeRequest?.status || 'Draft';
		}
	},
);

const showChangesDialog = ref(false);

const canShowMerge = computed(
	() => userStore.isWikiManager && crStore.changeCount > 0,
);

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
	if (spaceStore.isTreeReordering) {
		return __('Please wait for reordering to finish before merging');
	}
	return '';
});

const mergeDisabled = computed(
	() => spaceStore.isTreeReordering || hasUnsyncedWork.value,
);

const canShowDiscard = computed(
	() =>
		crStore.changeCount > 0 &&
		['Draft', 'In Review', 'Changes Requested'].includes(
			changeRequestStatus.value,
		),
);

const menuOptions = computed(() => {
	const options = [];
	if (crStore.changeCount > 0) {
		options.push({
			label: __('View changes ({0})', [crStore.changeCount]),
			icon: 'lucide-list',
			onClick: () => {
				showChangesDialog.value = true;
			},
		});
	}
	if (canShowDiscard.value) {
		options.push({
			label: __('Discard Changes'),
			icon: 'lucide-archive',
			onClick: crActions.discardChangeRequest,
		});
	}
	return options;
});

const STRIP_CONFIG = {
	Draft: {
		class: 'bg-surface-gray-2 text-ink-gray-8',
		title: __('Drafting Changes'),
	},
	'In Review': {
		class: 'bg-surface-amber-2 text-ink-amber-7',
		title: __('In Review'),
	},
	'Changes Requested': {
		class: 'bg-surface-red-2 text-ink-red-7',
		title: __('Changes Requested'),
	},
	Approved: {
		class: 'bg-surface-green-2 text-ink-green-7',
		title: __('Approved'),
	},
	Merged: {
		class: 'bg-surface-green-2 text-ink-green-7',
		title: __('Merged'),
	},
	Rejected: {
		class: 'bg-surface-red-2 text-ink-red-7',
		title: __('Rejected'),
	},
};

const DEFAULT_STRIP = {
	class: 'bg-surface-gray-2 text-ink-gray-8',
	title: __('Change Request'),
};

const stripConfig = computed(
	() => STRIP_CONFIG[changeRequestStatus.value] || DEFAULT_STRIP,
);
const stripClass = computed(() => stripConfig.value.class);
const stripTitle = computed(() => stripConfig.value.title);

const changeCountLabel = computed(() => {
	const count = crStore.changeCount;
	if (!count) return '';
	return __('{0} {1} changed', [count, count === 1 ? __('page') : __('pages')]);
});

// The only place the author sees why a CR bounced back; the status badge covers
// the generic states, so those blurbs are dropped.
const reviewFeedback = computed(() => {
	const cr = crStore.currentChangeRequest;
	const showsReviewComment = ['Changes Requested', 'Rejected'].includes(
		changeRequestStatus.value,
	);
	if (showsReviewComment && cr?.review_comment) {
		return cr.reviewed_by
			? __('{0} — {1}', [cr.review_comment, cr.reviewed_by])
			: cr.review_comment;
	}
	return '';
});
</script>
