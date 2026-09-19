<template>
	<section class="flex min-w-0 flex-col rounded-6 border border-outline-gray-1 bg-surface-elevation-2 px-4 py-3">
		<h3 class="text-base-medium text-ink-gray-8">{{ title }}</h3>
		<div v-if="loading" class="mt-3 flex flex-col gap-2">
			<Skeleton v-for="i in 4" :key="i" class="h-7 rounded-4" />
		</div>
		<p v-else-if="!rows.length" class="py-6 text-center text-sm text-ink-gray-5">
			{{ emptyText }}
		</p>
		<ol v-else class="mt-2 flex flex-col gap-1">
			<li v-for="row in rows" :key="row.key">
				<button
					v-if="row.selectable"
					type="button"
					:class="[ROW, 'hover:bg-surface-gray-2']"
					:title="row.hint"
					@click="emit('select', row)"
				>
					<span :class="BAR" :style="barWidth(row)" aria-hidden="true" />
					<span :class="LABEL">{{ row.label }}</span>
					<span :class="VALUE">{{ row.value.toLocaleString() }}</span>
				</button>
				<div v-else :class="ROW" :title="row.hint">
					<span :class="BAR" :style="barWidth(row)" aria-hidden="true" />
					<span :class="LABEL">{{ row.label }}</span>
					<span :class="VALUE">{{ row.value.toLocaleString() }}</span>
				</div>
			</li>
		</ol>
	</section>
</template>

<script setup>
import { Skeleton } from 'frappe-ui';
import { computed } from 'vue';

const props = defineProps({
	title: { type: String, required: true },
	rows: { type: Array, default: () => [] },
	loading: { type: Boolean, default: false },
	emptyText: { type: String, default: '' },
});

const emit = defineEmits(['select']);

const ROW =
	'relative flex h-8 w-full items-center gap-3 overflow-hidden rounded-4 px-2 text-left text-sm';
const BAR = 'absolute inset-y-1 left-0 rounded-4 bg-surface-blue-2';
const LABEL = 'relative min-w-0 flex-1 truncate text-ink-gray-8';
const VALUE = 'relative shrink-0 font-mono tabular-nums text-ink-gray-7';

const max = computed(() => Math.max(1, ...props.rows.map((row) => row.value)));

function barWidth(row) {
	return { width: `${(row.value / max.value) * 100}%` };
}
</script>
