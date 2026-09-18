<template>
	<div class="flex h-full flex-col" data-testid="overview-dashboard">
		<PageHeader>
			<h2 class="text-lg-semibold text-ink-gray-9">{{ __('Overview') }}</h2>
			<TabButtons
				v-model="preset"
				:options="rangeOptions"
				data-testid="overview-range"
			/>
		</PageHeader>

		<ScrollArea class="min-h-0 flex-1">
			<div class="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-8">
				<TrackingNotice
					v-if="data && !data.tracking_enabled"
					@enabled="reloadAll"
				/>

				<div class="grid grid-cols-1 gap-12 md:grid-cols-3">
					<div class="flex flex-col gap-6">
						<NumberCard
							v-for="(kpi, i) in kpis"
							:key="kpi.key"
							:card="false"
							:class="i > 0 && 'border-t border-outline-gray-1 pt-6'"
							:title="kpi.title"
							:value="data ? data[kpi.key].value : null"
							:delta="data?.[kpi.key].delta"
							delta-suffix="%"
							:loading="isFirstLoad"
							:data-testid="`overview-${kpi.key}`"
						/>
					</div>

					<section
						class="h-72 md:col-span-2"
						data-testid="overview-change-requests"
					>
						<DonutChart
							:title="__('Open change requests by space')"
							:subtitle="__('Right now')"
							:data="openChangeRequestsBySpace"
							category="space"
							value="count"
							:max-slices="6"
							:center-label="__('Open')"
							:loading="isFirstLoad"
							:error="errorOf(overview)"
						/>
					</section>
				</div>

				<section class="h-64" data-testid="overview-chart">
					<AreaChart
						:title="__('Page views')"
						:data="analytics.data?.series || []"
						x="date"
						:y="['views']"
						:series-config="{ views: { label: __('Views') } }"
						:x-axis="xAxis"
						:loading="analytics.loading && !analytics.data"
						:error="errorOf(analytics)"
					>
						<template #actions>
							<div class="flex items-center gap-3">
								<span class="text-sm text-ink-gray-5">{{ rangeLabel }}</span>
								<Select
									v-model="space"
									class="w-40"
									:options="spaceOptions"
									data-testid="overview-space"
								/>
							</div>
						</template>
					</AreaChart>
				</section>

				<div class="grid grid-cols-1 gap-12 md:grid-cols-2">
					<section data-testid="overview-spaces">
						<SectionTitle :title="__('Views by space')" :hint="rangeLabel" />
						<ListSkeleton v-if="isFirstLoad" />
						<p v-else-if="!data.spaces.length" :class="EMPTY">
							{{ __('No views in this range') }}
						</p>
						<router-link
							v-for="row in data?.spaces || []"
							v-else
							:key="row.name"
							:to="{ name: 'SpaceDetails', params: { spaceId: row.name } }"
							:class="ROW"
						>
							<SpaceAvatar
								:space="row"
								:label="row.space_name || row.name"
								size="md"
							/>
							<span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">
								{{ row.space_name || row.name }}
							</span>
							<div class="w-20 shrink-0 max-sm:hidden">
								<Progress size="sm" :value="share(row.views)" />
							</div>
							<span :class="COUNT">{{ formatCount(row.views) }}</span>
							<DeltaText :delta="row.delta" />
						</router-link>
					</section>

					<section data-testid="overview-top-pages">
						<SectionTitle :title="__('Top pages')" :hint="rangeLabel" />
						<ListSkeleton v-if="isFirstLoad" />
						<p v-else-if="!data.top_pages.length" :class="EMPTY">
							{{ __('No views in this range') }}
						</p>
						<router-link
							v-for="(row, i) in data?.top_pages || []"
							v-else
							:key="row.path"
							:to="pageLink(row)"
							:class="ROW"
							:title="`/${row.path}`"
						>
							<span class="w-4 shrink-0 text-right text-sm tabular-nums text-ink-gray-5">
								{{ i + 1 }}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-base text-ink-gray-8">
									{{ row.title || `/${row.path}` }}
								</span>
								<span class="mt-0.5 block truncate text-sm text-ink-gray-5">
									{{ row.space_name }}
								</span>
							</span>
							<span :class="COUNT">{{ formatCount(row.views) }}</span>
							<DeltaText :delta="row.delta" />
						</router-link>
					</section>
				</div>
			</div>
		</ScrollArea>
	</div>
</template>

<script setup>
import SpaceAvatar from '@/components/SpaceAvatar.vue';
import TrackingNotice from '@/components/Analytics/TrackingNotice.vue';
import { useAnalytics } from '@/composables/useAnalytics';
import { useUserStore } from '@/stores/user';
import {
	PageHeader,
	Progress,
	ScrollArea,
	Select,
	Skeleton,
	TabButtons,
	createResource,
	usePageMeta,
} from 'frappe-ui';
import { AreaChart, DonutChart, NumberCard } from 'frappe-ui/charts';
import { computed, h, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const ROW =
	'-mx-2 flex h-12 items-center gap-3 rounded-lg px-2 hover:bg-surface-gray-2';
const COUNT =
	'w-16 shrink-0 text-right text-base tabular-nums text-ink-gray-8';
const EMPTY = 'py-8 text-center text-sm text-ink-gray-5';

const RANGE_LABELS = {
	'7d': __('Last 7 days'),
	'30d': __('Last 30 days'),
	'90d': __('Last 90 days'),
};
const rangeOptions = [
	{ label: __('7 days'), value: '7d' },
	{ label: __('30 days'), value: '30d' },
	{ label: __('90 days'), value: '90d' },
];

const kpis = [
	{ key: 'views', title: __('Page views') },
	{ key: 'new_visitors', title: __('New visitors') },
	{ key: 'open_change_requests', title: __('Open change requests') },
];

if (!useUserStore().isWikiManager) useRouter().replace({ name: 'AllSpaces' });

const space = ref('');
const { analytics, preset, range } = useAnalytics(() =>
	space.value ? { space: space.value } : {},
);

const overview = createResource({
	url: 'wiki.api.analytics.get_overview',
	makeParams: () => ({ from_date: range.value[0], to_date: range.value[1] }),
});
watch(range, () => overview.reload(), { immediate: true });

const data = computed(() => overview.data);
const isFirstLoad = computed(() => overview.loading && !overview.data);
const rangeLabel = computed(() => RANGE_LABELS[preset.value]);
const xAxis = {
	type: 'time',
	timeGrain: 'day',
	echartOptions: { splitNumber: 15 },
};
const openChangeRequestsBySpace = computed(() =>
	(data.value?.open_change_requests_by_space || []).map((row) => ({
		space: row.space_name || row.space,
		count: row.count,
	})),
);

function reloadAll() {
	overview.reload();
	analytics.reload();
}

function errorOf(resource) {
	const error = resource.error;
	return error ? error.messages?.[0] || error.message : null;
}

const spaceOptions = computed(() => {
	const options = (data.value?.spaces || []).map((row) => ({
		label: row.space_name || row.name,
		value: row.name,
	}));
	if (space.value && !options.some((o) => o.value === space.value))
		options.push({ label: space.value, value: space.value });
	return [{ label: __('All spaces'), value: '' }, ...options];
});

function share(views) {
	const top = Math.max(1, ...data.value.spaces.map((row) => row.views));
	return (views / top) * 100;
}

function formatCount(value) {
	return value.toLocaleString();
}

function pageLink(row) {
	return row.document
		? { name: 'SpacePage', params: { spaceId: row.space, pageId: row.document } }
		: { name: 'SpaceDetails', params: { spaceId: row.space } };
}

function SectionTitle(props) {
	return h('div', { class: 'mb-3 flex items-baseline justify-between' }, [
		h('h3', { class: 'text-base-medium text-ink-gray-8' }, props.title),
		h('span', { class: 'text-sm text-ink-gray-5' }, props.hint),
	]);
}
SectionTitle.props = ['title', 'hint'];

function ListSkeleton() {
	return h(
		'div',
		{ class: 'flex flex-col gap-3' },
		[1, 2, 3, 4].map((i) => h(Skeleton, { key: i, class: 'h-9 rounded-lg' })),
	);
}

function DeltaText({ delta }) {
	const base = 'w-20 shrink-0 text-right text-sm tabular-nums';
	if (delta === null || delta === undefined) return h('span', { class: base });
	if (delta === 0)
		return h('span', { class: `${base} text-ink-gray-5` }, __('No change'));
	const sign = delta > 0 ? '+' : '';
	const tone = delta > 0 ? 'text-ink-green-7' : 'text-ink-red-7';
	return h('span', { class: `${base} ${tone}` }, `${sign}${delta}%`);
}
DeltaText.props = ['delta'];

usePageMeta(() => ({ title: `${__('Overview')} | Frappe Wiki` }));
</script>
