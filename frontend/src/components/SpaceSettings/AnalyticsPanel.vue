<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingsRow
			:title="__('Page views')"
			:description="__('Views of this space and its pages in the last 30 days')"
		>
			<span
				class="text-2xl font-semibold tabular-nums text-ink-gray-9"
				data-testid="analytics-total-views"
			>
				{{ analytics.data ? analytics.data.total_views.toLocaleString() : '-' }}
			</span>
		</SettingsRow>
	</div>
</template>

<script setup>
import { createResource, SettingsRow } from 'frappe-ui';

const props = defineProps({
	spaceId: {
		type: String,
		required: true,
	},
});

function toDateString(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const today = new Date();
const from = new Date(today);
from.setDate(today.getDate() - 29);

const analytics = createResource({
	url: 'wiki.api.analytics.get_analytics',
	params: {
		space: props.spaceId,
		from_date: toDateString(from),
		to_date: toDateString(today),
	},
	auto: true,
});
</script>
