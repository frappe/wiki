<template>
    <div class="flex h-full flex-col">
        <div
            v-if="spaceStore.isEditing && crStore.changeCount > 0"
            class="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-outline-gray-2 px-3 sm:px-5"
        >
            <MergeChangeRequestButton v-if="!isMobile" />
            <SubmitForReviewButton />
            <FinishEditingButton />
        </div>

        <!-- A git-synced space pulls its pages from GitHub on first open, so until
             that sync lands there's nothing to select — show progress instead of
             an empty state that invites a page the repo would overwrite. -->
        <div v-if="isSyncing" class="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
            <span class="lucide-loader-2 size-8 animate-spin text-ink-gray-4" aria-hidden="true" />
            <p class="mt-3 text-base-medium text-ink-gray-8">
                {{ __('Sync in progress') }}
            </p>
            <p class="mt-1 max-w-md text-sm text-ink-gray-5">
                {{ __('Pulling the latest pages from GitHub. This will only take a moment.') }}
            </p>
        </div>

        <!-- Nothing at all while the tree is still in flight: an unloaded tree looks
             exactly like an empty one, and guessing wrong flashes "create your first
             page" at a space that has hundreds. Same trap the sidebar's
             hasLoadedTree gate exists for. -->
        <div v-else-if="!isTreeLoaded" class="flex-1" />

        <!-- The sidebar states the fact ("No pages yet") in the tree, where the
             pages would be. This column carries the action, so the two columns read
             as one message instead of the same message twice. -->
        <div v-else class="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
            <span class="lucide-file-text size-8 text-ink-gray-4" aria-hidden="true" />
            <p class="mt-3 text-base-medium text-ink-gray-8">
                {{ hasPages ? __('Pick a page to edit') : emptyHeading }}
            </p>
            <p class="mt-1 max-w-md text-sm text-ink-gray-5">
                {{ hasPages ? __('Choose a page from the tree on the left.') : emptyHint }}
            </p>
            <Button
                v-if="!readonly && !hasPages"
                class="mt-4"
                variant="subtle"
                :label="__('New page')"
                @click="requestNewPage"
            >
                <template #prefix>
                    <span class="lucide-plus size-4" aria-hidden="true" />
                </template>
            </Button>
        </div>
    </div>
</template>

<script setup>
import { useMobile } from '@/composables/useMobile';
import { useNewPageRequest } from '@/composables/useNewPageRequest';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useSpaceStore } from '@/stores/space';
import { Button, usePageMeta } from 'frappe-ui';
import { computed } from 'vue';
import FinishEditingButton from './FinishEditingButton.vue';
import MergeChangeRequestButton from './MergeChangeRequestButton.vue';
import SubmitForReviewButton from './SubmitForReviewButton.vue';

// Passed down by SpaceDetails' router-view, which reads it off the space store.
defineProps({
	readonly: {
		type: Boolean,
		default: false,
	},
});

const spaceStore = useSpaceStore();
const crStore = useChangeRequestStore();
const { isMobile } = useMobile();
const { requestNewPage } = useNewPageRequest();

// In progress while the first sync is queued/running — or for a synced space
// that hasn't recorded a status yet (the auto first-sync is about to kick).
const isSyncing = computed(() => {
	const doc = spaceStore.doc;
	if (!doc?.git_synced) return false;
	const status = doc.last_sync_status;
	return status === 'Pending' || status === 'Running' || !status;
});

// treeData stays null until the tree lands, on both the CR and read-only paths.
const isTreeLoaded = computed(() => spaceStore.treeData != null);

// Same test the sidebar's own empty state uses, so the two columns never
// disagree about whether the space has anything in it.
const hasPages = computed(
	() => (spaceStore.treeData?.children?.length || 0) > 0,
);

const emptyHeading = computed(() =>
	spaceStore.isGitSynced
		? __('Nothing synced yet')
		: __('Create your first page'),
);

const emptyHint = computed(() =>
	spaceStore.isGitSynced
		? __('No pages have come across from the repository.')
		: __("This space doesn't have any pages yet."),
);

usePageMeta(() => {
	if (!spaceStore.doc) return;
	return { title: `${spaceStore.doc.space_name} | Frappe Wiki` };
});
</script>
