<template>
	<Alert
		data-testid="analytics-tracking-off"
		icon="lucide-eye-off"
		:title="__('Page views are not being recorded')"
		:description="
			isManager
				? __('Tracking counts visits to published pages and stores a device fingerprint for each visitor. It applies to the whole site.')
				: __('Ask a Wiki Manager to turn on page view tracking.')
		"
		:primary-action="
			isManager
				? {
						label: __('Turn on tracking'),
						loading: enableTracking.loading,
						onClick: () => enableTracking.submit({ enabled: true }),
					}
				: undefined
		"
	/>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import { Alert, createResource } from 'frappe-ui';
import { computed } from 'vue';

const emit = defineEmits(['enabled']);

const isManager = computed(() => useUserStore().isWikiManager);

const enableTracking = createResource({
	url: 'wiki.api.analytics.set_view_tracking',
	onSuccess: () => emit('enabled'),
});
</script>
