<template>
	<!-- Full-width chrome bar above the tab row: space identity (back + name +
	     view/settings) on the left, contextual actions on the right. Shared by
	     the change-request banner and the git-sync banner so both surfaces get
	     the same layout. -->
	<div
		class="min-h-10 px-2 py-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
		:class="barClass"
	>
		<div class="flex items-center gap-1 min-w-0">
			<Button
				class="-ml-2"
				variant="ghost"
				icon="arrow-left"
				:title="__('Back to Spaces')"
				:route="{ name: 'SpaceList' }"
			/>
			<div class="min-w-0 px-1 flex items-center gap-2">
				<span class="truncate text-base-medium leading-none text-ink-gray-8">
					{{ spaceName || __('Space') }}
				</span>
				<slot name="badge" />
			</div>
			<Button
				v-if="spaceRoute"
				variant="ghost"
				icon="external-link"
				:title="__('View Space')"
				:link="'/' + spaceRoute"
			/>
			<Button
				variant="ghost"
				icon="settings"
				:title="__('Settings')"
				@click="emit('open-settings')"
			/>
			<slot name="meta" />
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup>
import { Button } from 'frappe-ui';

defineProps({
	spaceName: { type: String, default: '' },
	// Drives the "View Space" external link; hidden when empty.
	spaceRoute: { type: String, default: '' },
	// Colour/border classes for the bar surface (e.g. the CR status colour).
	barClass: {
		type: String,
		default: 'bg-surface-gray-1 border-b border-outline-gray-2 text-ink-gray-8',
	},
});

const emit = defineEmits(['open-settings']);
</script>
