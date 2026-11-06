<template>
	<section
		class="overflow-hidden rounded-5 border border-outline-gray-1"
		data-testid="page-diff"
	>
		<header
			class="flex min-h-11 items-center gap-2 border-b border-outline-gray-1 bg-surface-gray-1 px-4 py-2"
		>
			<span :class="pageIcon" class="size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
			<template v-if="oldTitle">
				<span class="truncate text-base text-ink-gray-5 line-through">{{ oldTitle }}</span>
				<span class="lucide-arrow-right size-3.5 shrink-0 text-ink-gray-5" aria-hidden="true" />
			</template>
			<span class="truncate text-base-medium text-ink-gray-8">{{ title }}</span>
			<Badge
				:label="getChangeLabel(page.change_type)"
				:theme="getChangeTheme(page.change_type)"
				variant="subtle"
				size="sm"
			/>
			<span v-if="summary" class="ml-auto shrink-0 text-xs text-ink-gray-5">{{ summary }}</span>
		</header>

		<div v-if="page.change_type === 'reordered'" class="flex flex-wrap items-center gap-3 p-4 text-sm">
			<div class="flex items-center gap-2 rounded-5 bg-surface-gray-2 px-3 py-2 text-ink-gray-6">
				<span>{{ locationPath(page.location?.base) }}</span>
				<Badge v-if="positionLabel(page.location?.base)" variant="subtle" theme="gray" size="sm">
					{{ positionLabel(page.location?.base) }}
				</Badge>
			</div>
			<span class="lucide-arrow-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
			<div class="flex items-center gap-2 rounded-5 bg-surface-gray-2 px-3 py-2 font-medium text-ink-gray-8">
				<span>{{ locationPath(page.location?.head) }}</span>
				<Badge v-if="positionLabel(page.location?.head)" variant="subtle" theme="amber" size="sm">
					{{ positionLabel(page.location?.head) }}
				</Badge>
			</div>
		</div>

		<div v-else-if="page.is_group || page.is_external_link" class="px-4 py-3 text-sm text-ink-gray-5">
			{{ getChangeDescription(page.change_type, page.is_group, page.is_external_link) }}
			<a
				v-if="page.external_url"
				:href="page.external_url"
				target="_blank"
				rel="noopener noreferrer"
				class="text-ink-blue-link hover:underline"
			>
				{{ page.external_url }}
			</a>
		</div>

		<div v-else-if="view === 'markdown'" class="relative isolate z-0 p-4">
			<DiffViewer
				:old-content="page.base?.content || ''"
				:new-content="page.head?.content || ''"
				:file-name="title"
				:show-header="false"
				language="markdown"
			/>
		</div>

		<div v-else ref="body" class="wiki-rendered prose prose-v3 max-w-none px-5 py-5">
			<div v-if="layout === 'split'" class="grid grid-cols-2 gap-x-8 gap-y-0.5">
				<p class="not-prose pb-2 pl-3 text-sm text-ink-gray-5">{{ __('Before') }}</p>
				<p class="not-prose pb-2 pl-3 text-sm text-ink-gray-5">{{ __('After') }}</p>
				<template v-for="(row, index) in rows" :key="index">
					<div v-if="row.kind === 'gap'" class="not-prose col-span-2 flex items-center gap-3 py-2 text-xs text-ink-gray-5">
						<span class="flex-1 border-t border-dashed border-outline-gray-2" />
						{{ gapLabel(row.count) }}
						<span class="flex-1 border-t border-dashed border-outline-gray-2" />
					</div>
					<template v-else>
						<div
							v-for="side in ['before', 'after']"
							:key="side"
							class="page-diff-block min-h-8 min-w-0 px-3 py-1.5"
							:class="splitClass(row, side)"
							:style="row[side] ? null : HATCH"
							v-html="splitHtml(row, side)"
						/>
					</template>
				</template>
			</div>

			<div v-else class="mx-auto max-w-3xl space-y-0.5">
				<template v-for="(row, index) in rows" :key="index">
					<div v-if="row.kind === 'gap'" class="not-prose flex items-center gap-3 py-2 text-xs text-ink-gray-5">
						<span class="flex-1 border-t border-dashed border-outline-gray-2" />
						{{ gapLabel(row.count) }}
						<span class="flex-1 border-t border-dashed border-outline-gray-2" />
					</div>
					<template v-else-if="row.kind === 'change' && !row.tokens">
						<div class="page-diff-block border-l-2 border-outline-red-4 bg-surface-red-1 px-3 py-1.5" v-html="row.before.html" />
						<div class="page-diff-block border-l-2 border-outline-green-4 bg-surface-green-1 px-3 py-1.5" v-html="row.after.html" />
					</template>
					<div
						v-else
						class="page-diff-block border-l-2 px-3 py-1.5"
						:class="INLINE_CLASSES[row.kind]"
						v-html="inlineHtml(row)"
					/>
				</template>
			</div>
		</div>
	</section>
</template>

<script setup>
import { useChangeTypeDisplay } from '@/composables/useChangeTypeDisplay';
import {
	diffBlocks,
	foldUnchanged,
	renderInline,
	renderSide,
	splitBlocks,
	summarize,
} from '@/lib/blockDiff';
import { Badge } from 'frappe-ui';
import {
	computed,
	defineAsyncComponent,
	nextTick,
	onBeforeUnmount,
	useTemplateRef,
	watch,
} from 'vue';
import { renderMermaid } from '../../../wiki/public/js/mermaid-renderer.js';
import { bindThemeImages } from '../../../wiki/public/js/theme-images.js';
import { getMermaid } from './tiptap-extensions/mermaid-loader.js';

const props = defineProps({
	page: { type: Object, required: true },
	view: { type: String, default: 'split' },
	changesOnly: { type: Boolean, default: false },
});

const DiffViewer = defineAsyncComponent(() => import('./DiffViewer.vue'));

const HATCH =
	'background-image: repeating-linear-gradient(-45deg, transparent 0 6px, rgb(128 128 128 / 0.16) 6px 7px)';
const INLINE_CLASSES = {
	same: 'border-transparent',
	add: 'border-outline-green-4 bg-surface-green-1',
	del: 'border-outline-red-4 bg-surface-red-1 line-through decoration-ink-red-5 opacity-70',
	change: 'border-outline-amber-4',
};

const { getChangeLabel, getChangeTheme, getChangeDescription } =
	useChangeTypeDisplay();
const body = useTemplateRef('body');

const title = computed(
	() => props.page.head?.title || props.page.base?.title || __('Untitled'),
);
const oldTitle = computed(() => {
	const before = props.page.base?.title;
	return before && props.page.head && before !== props.page.head.title
		? before
		: null;
});
const pageIcon = computed(() => {
	if (props.page.is_group) return 'lucide-folder';
	if (props.page.is_external_link) return 'lucide-link';
	return 'lucide-file-text';
});

const allRows = computed(() =>
	diffBlocks(
		splitBlocks(props.page.base?.html),
		splitBlocks(props.page.head?.html),
	),
);
const rows = computed(() =>
	props.changesOnly ? foldUnchanged(allRows.value) : allRows.value,
);

// A page added or deleted has nothing to line up against.
const layout = computed(() =>
	props.page.base && props.page.head ? props.view : 'inline',
);

const summary = computed(() => {
	if (props.page.is_group || props.page.is_external_link) return '';
	if (props.page.change_type === 'reordered') return '';
	const { added, edited, removed } = summarize(allRows.value);
	const parts = [
		added && __('{0} added', [added]),
		edited && __('{0} edited', [edited]),
		removed && __('{0} removed', [removed]),
	].filter(Boolean);
	return parts.length ? parts.join(', ') : __('No content changes');
});

function splitHtml(row, side) {
	if (!row[side]) return '';
	return row.kind === 'change' && row.tokens
		? renderSide(row.tokens, side)
		: row[side].html;
}

function splitClass(row, side) {
	if (!row[side] || row.kind === 'same') return 'border-l-2 border-transparent';
	const border =
		side === 'before' ? 'border-outline-red-4' : 'border-outline-green-4';
	if (row.kind === 'change') return `border-l-2 ${border}`;
	return `border-l-2 ${border} ${side === 'before' ? 'bg-surface-red-1' : 'bg-surface-green-1'}`;
}

function inlineHtml(row) {
	if (row.kind === 'change') return renderInline(row.tokens);
	return (row.after ?? row.before).html;
}

function gapLabel(count) {
	return count === 1
		? __('1 unchanged block')
		: __('{0} unchanged blocks', [count]);
}

function locationPath(location) {
	return [...(location?.path || []), title.value].filter(Boolean).join('  /  ');
}

function positionLabel(location) {
	if (!location?.position) return '';
	return `${__('Position')} ${location.position} / ${location.total}`;
}

let unbindThemeImages = null;
watch(
	[body, rows, layout],
	async () => {
		await nextTick();
		unbindThemeImages?.();
		unbindThemeImages = null;
		if (!body.value) return;
		renderMermaid(body.value, getMermaid);
		highlightCode(body.value);
		unbindThemeImages = bindThemeImages(body.value);
	},
	{ immediate: true },
);
onBeforeUnmount(() => unbindThemeImages?.());

// highlight.js rewrites the block from its text, so a block with word marks stays plain.
async function highlightCode(root) {
	const blocks = [...root.querySelectorAll('pre > code:not(.hljs)')].filter(
		(code) => !code.querySelector('ins, del'),
	);
	if (!blocks.length) return;
	const { default: hljs } = await import('highlight.js/lib/common');
	for (const code of blocks) hljs.highlightElement(code);
}
</script>

<style>
/* Each block renders on its own, so the article's vertical rhythm is the row's padding instead. */
.page-diff-block > * {
	margin-top: 0;
	margin-bottom: 0;
}
</style>
