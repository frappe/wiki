import {
	PRESETS,
	drillDownRange,
	intervalFor,
	presetRange,
} from '@/lib/analyticsRange';
import { createResource } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

/**
 * The wiki-wide Overview and the space and page dashboards share this so they
 * pick date ranges, drill into a bar and refetch on a scope change the same way.
 * `scope` returns `{ space, document }`; leave both out for the whole wiki.
 */
export function useAnalytics(scope, { preset: initialPreset = '30d' } = {}) {
	const preset = ref(initialPreset);
	const customRange = ref([]);

	const range = computed(() => {
		if (preset.value === 'custom') return customRange.value;
		return presetRange(PRESETS.find((p) => p.value === preset.value).days);
	});
	const interval = computed(() =>
		range.value.length ? intervalFor(range.value) : 'daily',
	);

	const analytics = createResource({
		url: 'wiki.api.analytics.get_analytics',
		makeParams: () => ({
			from_date: range.value[0],
			to_date: range.value[1],
			interval: interval.value,
			...scope(),
		}),
	});

	watch(
		[range, scope],
		() => {
			if (range.value.length) analytics.reload();
		},
		{ immediate: true, deep: true },
	);

	function setCustomRange(value) {
		customRange.value = value;
		preset.value = 'custom';
	}

	function drillDown(bucket) {
		const days = drillDownRange(bucket, interval.value, range.value);
		if (days) setCustomRange(days);
	}

	return {
		analytics,
		preset,
		range,
		interval,
		setCustomRange,
		drillDown,
	};
}
