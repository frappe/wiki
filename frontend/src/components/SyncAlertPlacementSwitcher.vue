<template>
	<!-- TEMPORARY — a floating switch for comparing the three placements of the
	     sidebar's sync notice. Delete this component, lib/syncAlertPlacement.js
	     and the branches that read `syncAlertPlacement` once one is chosen. -->
	<div
		class="fixed bottom-4 right-4 z-[100] w-64 rounded-6 border border-outline-gray-2 bg-surface-elevation-1 p-3 shadow-xl"
	>
		<div class="flex items-center justify-between gap-2">
			<span class="text-xs-medium text-ink-gray-8">Sync notice</span>
			<button
				type="button"
				class="text-xs text-ink-gray-5 hover:text-ink-gray-8"
				@click="collapsed = !collapsed"
			>
				{{ collapsed ? 'Show' : 'Hide' }}
			</button>
		</div>

		<template v-if="!collapsed">
			<div class="mt-2">
				<TabButtons
					v-model="syncAlertPlacement"
					:options="placementOptions"
					fluid
				/>
			</div>
			<p class="mt-1.5 text-xs leading-4 text-ink-gray-5">{{ hint }}</p>

			<div class="mt-3">
				<span class="text-xs text-ink-gray-5">Pin a state</span>
				<div class="mt-1">
					<TabButtons
						v-model="syncAlertPreview"
						:options="previewOptions"
						fluid
					/>
				</div>
			</div>
		</template>
	</div>
</template>

<script setup>
import { TabButtons } from 'frappe-ui';
import { computed, ref } from 'vue';

import {
	SYNC_ALERT_PLACEMENTS,
	SYNC_ALERT_PREVIEWS,
	syncAlertPlacement,
	syncAlertPreview,
} from '../lib/syncAlertPlacement';

const collapsed = ref(false);

const placementOptions = SYNC_ALERT_PLACEMENTS.map(({ value, label }) => ({
	value,
	label,
}));
const previewOptions = SYNC_ALERT_PREVIEWS;

const hint = computed(
	() =>
		SYNC_ALERT_PLACEMENTS.find((p) => p.value === syncAlertPlacement.value)
			?.hint || '',
);
</script>
