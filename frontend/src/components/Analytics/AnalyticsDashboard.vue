<template>
	<div class="flex flex-col gap-4" data-testid="analytics-dashboard">
		<div class="flex flex-wrap items-center gap-2">
			<Select
				v-model="preset"
				class="w-40"
				:options="presetOptions"
				data-testid="analytics-range"
			/>
			<DateRangePicker
				v-if="preset === 'custom'"
				class="w-60"
				:model-value="range"
				@update:model-value="setCustomRange"
			/>
			<Button
				v-if="page"
				variant="subtle"
				icon-right="lucide-x"
				:label="page.title || __('Page')"
				:tooltip="__('Show the whole space')"
				data-testid="analytics-page-filter"
				@click="emit('update:page', null)"
			>
				<template #prefix>
					<span class="lucide-file-text size-3.5" aria-hidden="true" />
				</template>
			</Button>
		</div>

		<div
			v-if="data && !data.tracking_enabled"
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
				@click="enableTracking.submit()"
			/>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<NumberCard
				:title="__('Views')"
				:value="data?.total_views ?? null"
				:loading="isFirstLoad"
				data-testid="analytics-total-views"
			/>
			<NumberCard
				:title="__('New visitors')"
				:value="data?.new_visitors ?? null"
				:loading="isFirstLoad"
				data-testid="analytics-new-visitors"
			/>
		</div>

		<section :class="[CARD, 'h-72']" data-testid="analytics-chart">
			<BarChart
				ref="chartRef"
				:title="__('Views over time')"
				:subtitle="chartSubtitle"
				:data="data?.series || []"
				x="date"
				:y="['views', 'new_visitors']"
				palette="categorical"
				:series-config="seriesConfig"
				:x-axis="{ type: 'time', timeGrain: TIME_GRAINS[interval] }"
				:loading="isFirstLoad"
				:error="errorMessage"
			/>
		</section>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<TopList
				v-if="!page"
				:title="__('Top pages')"
				:rows="topPages"
				:loading="isFirstLoad"
				:empty-text="__('No views in this range')"
				data-testid="analytics-top-pages"
				@select="(row) => emit('update:page', { document: row.key, title: row.label })"
			/>
			<TopList
				:title="__('Top referrers')"
				:rows="topReferrers"
				:loading="isFirstLoad"
				:empty-text="__('No views in this range')"
				data-testid="analytics-top-referrers"
			/>
		</div>
	</div>
</template>

<script setup>
import TopList from '@/components/Analytics/TopList.vue';
import { useAnalytics } from '@/composables/useAnalytics';
import { PRESETS } from '@/lib/analyticsRange';
import { useUserStore } from '@/stores/user';
import { Button, DateRangePicker, Select, createResource } from 'frappe-ui';
import { BarChart, NumberCard } from 'frappe-ui/charts';
import { computed, ref, watch } from 'vue';

const props = defineProps({
	space: { type: String, default: null },
	page: { type: Object, default: null },
});

const emit = defineEmits(['update:page']);

const CARD =
	'flex min-w-0 flex-col rounded-xl border border-outline-gray-1 bg-surface-elevation-2 px-4 py-3';
const TIME_GRAINS = { daily: 'day', weekly: 'week', monthly: 'month' };
const PRESET_LABELS = {
	'7d': __('Last 7 days'),
	'30d': __('Last 30 days'),
	'90d': __('Last 90 days'),
	'180d': __('Last 180 days'),
	'12m': __('Last 12 months'),
};
const presetOptions = [
	...PRESETS.map((p) => ({ label: PRESET_LABELS[p.value], value: p.value })),
	{ label: __('Custom range'), value: 'custom' },
];

const isManager = computed(() => useUserStore().isWikiManager);

const { analytics, preset, range, interval, setCustomRange, drillDown } =
	useAnalytics(() =>
		props.page
			? { document: props.page.document }
			: { space: props.space || undefined },
	);

const data = computed(() => analytics.data);
const isFirstLoad = computed(() => analytics.loading && !analytics.data);
const errorMessage = computed(() => {
	const error = analytics.error;
	return error ? error.messages?.[0] || error.message : null;
});

const enableTracking = createResource({
	url: 'wiki.api.analytics.enable_view_tracking',
	onSuccess: () => analytics.reload(),
});

const seriesConfig = {
	views: { label: __('Views') },
	new_visitors: { label: __('New visitors'), type: 'line' },
};

const chartSubtitle = computed(() => {
	if (!range.value.length) return '';
	const format = (value) =>
		new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	const span = __('{0} to {1}', [
		format(range.value[0]),
		format(range.value[1]),
	]);
	if (interval.value === 'weekly')
		return `${span} · ${__('Click a week to see its days')}`;
	if (interval.value === 'monthly')
		return `${span} · ${__('Click a month to see its days')}`;
	return span;
});

const chartRef = ref(null);
watch(
	() => chartRef.value?.chart,
	(chart) => {
		chart?.getZr().on('click', ({ offsetX, offsetY }) => {
			const series = data.value?.series;
			if (!series?.length || !chart.containPixel('grid', [offsetX, offsetY]))
				return;
			const time = chart.convertFromPixel({ xAxisIndex: 0 }, offsetX);
			const distance = (row) =>
				Math.abs(new Date(`${row.date}T00:00:00`) - time);
			const nearest = series.reduce((a, b) =>
				distance(b) < distance(a) ? b : a,
			);
			drillDown(nearest.date);
		});
	},
);

const topPages = computed(() =>
	(data.value?.top_pages || []).map((row) => ({
		key: row.document || row.path,
		label: row.title || `/${row.path}`,
		hint: `/${row.path}`,
		value: row.views,
		selectable: Boolean(props.space && row.document),
	})),
);

const topReferrers = computed(() =>
	(data.value?.top_referrers || []).map((row) => ({
		key: row.referrer || '',
		label: row.referrer || __('Direct'),
		value: row.views,
	})),
);
</script>
