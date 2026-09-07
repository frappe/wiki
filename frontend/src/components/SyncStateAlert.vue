<template>
	<Alert
		v-if="label"
		data-testid="sync-state-alert"
		:title="label"
		:description="description || undefined"
		:theme="theme"
	/>
</template>

<script setup>
import { Alert } from 'frappe-ui';
import { computed } from 'vue';

import { useSyncState } from '../composables/useSyncState';
// TEMPORARY — remove with SyncAlertPlacementSwitcher.
import { PREVIEW_STATES, syncAlertPreview } from '../lib/syncAlertPlacement';

const state = useSyncState();

const preview = computed(() => PREVIEW_STATES[syncAlertPreview.value] || null);

const label = computed(() => preview.value?.label ?? state.label.value);
const theme = computed(() => preview.value?.theme ?? state.theme.value);
const description = computed(
	() => preview.value?.description ?? state.description.value,
);
</script>
