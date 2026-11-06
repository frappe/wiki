<template>
	<!-- The mode strip sits directly under the space header in the sidebar. A
	     git-synced space and a space being edited are read and edited in
	     different ways, and the strip says which one you are in before you click
	     anything. Reading a space that is not synced needs no strip. -->
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
		v-else-if="spaceStore.isEditing"
		class="contribution-strip shrink-0 px-2 pt-2"
	>
		<!-- 260px does not fit a label and two buttons on one line, so the meta
		     line and the actions stack. -->
		<div class="rounded-4 px-2 py-2" :class="stripClass">
			<div class="flex items-start gap-1.5">
				<!-- The card's own tint carries the status, so a subtle badge on top
				     of it would be one grey box inside another. -->
				<button
					type="button"
					class="min-w-0 flex-1 truncate rounded-2 text-left text-xs-medium hover:underline focus-visible:ring-2 focus-visible:ring-outline-gray-3"
					:title="__('Edit title and description')"
					@click="openDetailsDialog"
				>
					{{ changeRequestTitle }}
				</button>
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

			<p class="mt-1 truncate text-xs text-ink-gray-6">
				{{ metaLine }}
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

			<!-- Outline, not subtle: a subtle gray button is drawn on
			     surface-gray-2, which is this card's own tint in the Draft state,
			     so it vanished into it. -->
			<MergeChangeRequestButton
				v-if="isMobile"
				class="mt-2 w-full"
				size="sm"
			/>

			<Button
				v-if="crStore.finalizing === 'withdrawing'"
				class="mt-2 w-full"
				variant="outline"
				size="sm"
				loading
				disabled
			>
				{{ __('Discard') }}
			</Button>
		</div>
	</div>

	<Dialog v-model:open="showDetailsDialog">
		<template #title>
			<h3 class="text-2xl-semibold text-ink-gray-9">
				{{ __('Change request') }}
			</h3>
		</template>
		<template #default>
			<form class="space-y-4" @submit.prevent="saveDetails">
				<FormControl
					v-model="detailsTitle"
					:label="__('Title')"
					type="text"
					required
					autofocus
				/>
				<FormControl
					v-model="detailsDescription"
					:label="__('Description')"
					type="textarea"
					:placeholder="__('Describe the change')"
					:rows="3"
				/>
			</form>
		</template>
		<template #actions>
			<div class="flex justify-end gap-2">
				<Button variant="outline" @click="showDetailsDialog = false">
					{{ __('Cancel') }}
				</Button>
				<Button
					variant="solid"
					:loading="savingDetails"
					:disabled="!detailsTitle.trim()"
					@click="saveDetails"
				>
					{{ __('Save') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import {
	Badge,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	dayjsLocal,
	toast,
} from 'frappe-ui';
import { computed, ref, watch } from 'vue';

import { useChangeRequestActions } from '../composables/useChangeRequestActions';
import { useMobile } from '../composables/useMobile';
import { useChangeRequestStore } from '../stores/changeRequest';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';
import MergeChangeRequestButton from './MergeChangeRequestButton.vue';
import SyncStateAlert from './SyncStateAlert.vue';

defineProps({
	// The mobile strip renders inline above the content and is the only place
	// the sync notice has to live there; the desktop sidebar floats its own.
	showSyncState: { type: Boolean, default: false },
});

const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const crActions = useChangeRequestActions();
const { isMobile } = useMobile();

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

const changeRequestTitle = computed(
	() => crStore.currentChangeRequest?.title || __('Untitled change request'),
);

const showDetailsDialog = ref(false);
const detailsTitle = ref('');
const detailsDescription = ref('');
const savingDetails = ref(false);

function openDetailsDialog() {
	detailsTitle.value = crStore.currentChangeRequest?.title || '';
	detailsDescription.value = crStore.currentChangeRequest?.description || '';
	showDetailsDialog.value = true;
}

async function saveDetails() {
	const title = detailsTitle.value.trim();
	if (!title || savingDetails.value) return;
	savingDetails.value = true;
	try {
		await crStore.updateChangeRequest({
			title,
			description: detailsDescription.value.trim(),
		});
		showDetailsDialog.value = false;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating change request'));
	} finally {
		savingDetails.value = false;
	}
}

// Offered with no changes too: it is how you leave edit mode after an Edit you
// did not need. A change request in review may be someone else's work, so it
// is left with Save, never archived from here.
const canShowDiscard = computed(
	() => !crStore.finalizing && !spaceStore.isEditingInReview,
);

const menuOptions = computed(() => {
	const options = [];
	if (crStore.changeCount > 0) {
		options.push({
			label: __('View changes ({0})', [crStore.changeCount]),
			icon: 'lucide-git-compare',
			onClick: crActions.viewChanges,
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

// Only change requests being edited reach the strip; the rest are read mode.
const STRIP_CONFIG = {
	Draft: {
		class: 'bg-surface-gray-2 text-ink-gray-8',
		label: __('Draft'),
	},
	'Changes Requested': {
		class: 'bg-surface-red-2 text-ink-red-7',
		label: __('Changes requested'),
	},
	'In Review': {
		class: 'bg-surface-amber-2 text-ink-amber-7',
		label: __('In review'),
	},
	Approved: {
		class: 'bg-surface-green-2 text-ink-green-7',
		label: __('Approved'),
	},
};

const stripConfig = computed(
	() => STRIP_CONFIG[changeRequestStatus.value] || STRIP_CONFIG.Draft,
);
const stripClass = computed(() => stripConfig.value.class);

const metaLine = computed(() => {
	const count = crStore.changeCount;
	const changed = count
		? __('{0} {1} changed', [count, count === 1 ? __('page') : __('pages')])
		: __('No changes yet');
	return `${stripConfig.value.label} · ${changed}`;
});

// The only place the author sees why a CR bounced back; the status badge covers
// the generic states, so those blurbs are dropped.
const reviewFeedback = computed(() => {
	const cr = crStore.currentChangeRequest;
	const showsReviewComment = changeRequestStatus.value === 'Changes Requested';
	if (showsReviewComment && cr?.review_comment) {
		return cr.reviewed_by
			? __('{0} — {1}', [cr.review_comment, cr.reviewed_by])
			: cr.review_comment;
	}
	return '';
});
</script>
