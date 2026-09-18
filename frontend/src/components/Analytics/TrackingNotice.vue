<template>
	<div
		class="flex flex-col gap-3 rounded-xl border border-outline-amber-2 bg-surface-amber-1 px-4 py-3 sm:flex-row sm:items-center"
		data-testid="analytics-tracking-off"
	>
		<span class="lucide-eye-off size-4 shrink-0 text-ink-amber-3" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<p class="text-base-medium text-ink-gray-8">
				{{ __('Page views are not being recorded') }}
			</p>
			<p class="mt-0.5 text-p-sm text-ink-gray-6">
				{{
					isManager
						? __('Tracking counts visits to published pages and stores a device fingerprint for each visitor. It applies to the whole site.')
						: __('Ask a Wiki Manager to turn on page view tracking.')
				}}
			</p>
		</div>
		<Button
			v-if="isManager"
			variant="solid"
			:label="__('Turn on tracking')"
			:loading="enableTracking.loading"
			@click="enableTracking.submit({ enabled: true })"
		/>
	</div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import { Button, createResource } from 'frappe-ui';
import { computed } from 'vue';

const emit = defineEmits(['enabled']);

const isManager = computed(() => useUserStore().isWikiManager);

const enableTracking = createResource({
	url: 'wiki.api.analytics.set_view_tracking',
	onSuccess: () => emit('enabled'),
});
</script>
