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

import { useSyncState } from '../composables/useSyncState';

const { label, theme, description } = useSyncState();
</script>
