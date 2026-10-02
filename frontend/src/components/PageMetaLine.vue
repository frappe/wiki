<template>
	<div
		class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-gray-5"
		data-testid="page-meta-line"
	>
		<template v-for="(part, index) in parts" :key="part.key">
			<span v-if="index" aria-hidden="true">·</span>
			<button
				v-if="part.key === 'views'"
				type="button"
				class="-mx-1 inline-flex items-center gap-1 rounded-1 px-1 hover:bg-surface-gray-2 hover:text-ink-gray-7"
				:title="__('Open page analytics')"
				data-testid="page-views-link"
				@click="openAnalytics({ document: docName, title })"
			>
				<span class="lucide-chart-no-axes-column size-3.5" aria-hidden="true" />
				{{ part.label }}
			</button>
			<span v-else>{{ part.label }}</span>
		</template>
	</div>
</template>

<script setup>
import { useSpaceSettings } from '@/composables/useSpaceSettings';
import { countWords, readingMinutes } from '@/lib/readingStats';
import { createResource, dayjsLocal } from 'frappe-ui';
import { computed } from 'vue';

const props = defineProps({
	doc: {
		type: Object,
		required: true,
	},
	title: {
		type: String,
		default: '',
	},
	content: {
		type: String,
		default: '',
	},
});

const { openAnalytics } = useSpaceSettings();

const docName = props.doc.name;
const recentViews = createResource({
	url: 'wiki.api.analytics.get_page_views',
	params: { document: docName },
	cache: ['page-views', docName],
	auto: true,
});

const parts = computed(() => {
	const result = [];
	const minutes = readingMinutes(countWords(props.content));
	if (minutes) {
		result.push({ key: 'reading', label: __('{0} min read', [minutes]) });
	}
	const views = recentViews.data;
	if (typeof views === 'number') {
		const label =
			views === 1
				? __('1 view in 30 days')
				: __('{0} views in 30 days', [views.toLocaleString()]);
		result.push({ key: 'views', label });
	}
	if (props.doc.modified) {
		const ago = dayjsLocal(props.doc.modified).fromNow();
		result.push({ key: 'edited', label: __('Edited {0}', [ago]) });
	}
	return result;
});
</script>
