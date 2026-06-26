<template>
    <!-- A git-synced space pulls its pages from GitHub on first open, so until
         that sync lands there's nothing to select — show progress instead of
         the "Select a page" empty state. -->
    <div v-if="isSyncing" class="flex flex-col items-center justify-center h-full py-16">
        <LucideLoader2 class="size-12 text-ink-gray-4 mb-6 animate-spin" />
        <h2 class="text-xl font-medium text-ink-gray-7 mb-2">
            {{ __('Sync in progress') }}
        </h2>
        <p class="text-ink-gray-5 text-center max-w-md">
            {{ __('Pulling the latest pages from GitHub. This will only take a moment.') }}
        </p>
    </div>

    <div v-else class="flex flex-col items-center justify-center h-full py-16">
        <LucideFileText class="size-16 text-ink-gray-3 mb-6" />
        <h2 class="text-xl font-medium text-ink-gray-7 mb-2">
            {{ __('Select a page') }}
        </h2>
        <p class="text-ink-gray-5 text-center max-w-md">
            {{ __('Choose a page from the sidebar to view and edit, or create a new page to get started.') }}
        </p>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { getCachedDocumentResource, usePageMeta } from 'frappe-ui';
import { useRoute } from 'vue-router';
import LucideFileText from '~icons/lucide/file-text';
import LucideLoader2 from '~icons/lucide/loader-2';

const route = useRoute();

// SpaceDetails (the parent layout) creates the Wiki Space document resource,
// so this is always a cache read — never a fetch.
const space = computed(() =>
	getCachedDocumentResource('Wiki Space', route.params.spaceId),
);

// In progress while the first sync is queued/running — or for a synced space
// that hasn't recorded a status yet (the auto first-sync is about to kick).
const isSyncing = computed(() => {
	const doc = space.value?.doc;
	if (!doc?.git_synced) return false;
	const status = doc.last_sync_status;
	return status === 'Pending' || status === 'Running' || !status;
});

usePageMeta(() => {
	if (!space.value?.doc) return;
	return { title: `${space.value.doc.space_name} | Frappe Wiki` };
});
</script>
