<template>
	<Alert
		v-if="label"
		data-testid="sync-state-alert"
		:title="label"
		:description="description || undefined"
		:theme="theme"
	>
		<template v-if="isSaving" #prefix>
			<LoadingIndicator class="size-4 text-ink-gray-5" />
		</template>
	</Alert>
</template>

<script setup>
import { Alert, LoadingIndicator } from 'frappe-ui';

import { useSyncState } from '../composables/useSyncState';

const { label, theme, description, isSaving } = useSyncState();
</script>
