<template>
	<aside
		class="flex h-full w-[352px] shrink-0 flex-col border-l border-outline-gray-2"
		data-testid="history-panel"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-2 px-3"
		>
			<span class="truncate text-base-medium text-ink-gray-8">
				{{ __('Version history') }}
			</span>
			<Tooltip :text="__('Close version history')">
				<Button
					variant="ghost"
					:aria-label="__('Close version history')"
					@click="emit('close')"
				>
					<span class="lucide-x size-4" aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>

		<div class="px-3 pt-3">
			<TabButtons v-model="scope" :options="scopeOptions" fluid />
		</div>

		<ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pb-10 pt-2">
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left"
				:class="selected ? 'hover:bg-surface-gray-2' : 'bg-surface-gray-3'"
				@click="selected = null"
			>
				<span
					class="grid size-6 shrink-0 place-items-center rounded-full bg-surface-green-2 text-ink-green-6"
				>
					<span class="lucide-radio size-3.5" aria-hidden="true" />
				</span>
				<span class="min-w-0">
					<span class="block text-sm-medium text-ink-gray-8">{{ __('Current version') }}</span>
					<span class="block text-xs text-ink-gray-5">{{ __('Live now') }}</span>
				</span>
			</button>

			<div v-if="!history.data && history.loading" class="space-y-4 px-2 pt-5">
				<div v-for="n in 4" :key="n" class="flex gap-2">
					<Skeleton class="size-6 shrink-0 rounded-full" />
					<div class="flex-1 space-y-1.5">
						<Skeleton class="h-3.5 w-3/4 rounded-4" />
						<Skeleton class="h-3 w-1/2 rounded-4" />
					</div>
				</div>
			</div>

			<div
				v-else-if="!versions.length"
				class="flex flex-col items-center gap-2 px-4 py-16 text-center"
			>
				<div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
					<span class="lucide-history size-6" aria-hidden="true" />
				</div>
				<p class="text-base text-ink-gray-7">{{ __('No history yet') }}</p>
				<p class="text-p-sm text-ink-gray-5">
					{{ __('Versions appear here once a change request is merged.') }}
				</p>
			</div>

			<template v-else>
				<section v-for="group in groups" :key="group.label" :aria-label="group.label">
					<h4 class="px-2 pb-1 pt-4 text-sm text-ink-gray-5">{{ group.label }}</h4>
					<button
						v-for="version in group.versions"
						:key="version.revision"
						type="button"
						class="flex w-full items-start gap-2 rounded-4 px-2 py-1.5 text-left"
						:class="
							selected?.revision === version.revision
								? 'bg-surface-gray-3'
								: 'hover:bg-surface-gray-2'
						"
						:aria-pressed="selected?.revision === version.revision"
						data-testid="history-version"
						@click="selected = version"
					>
						<Avatar
							:image="version.author.image"
							:label="version.author.full_name"
							size="sm"
							class="mt-0.5 shrink-0"
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs text-ink-gray-5">
								<span class="text-ink-gray-7">{{ version.author.full_name }}</span>
								{{ versionAction(version) }}
							</span>
							<span class="block truncate text-sm-medium text-ink-gray-8">
								{{ versionTitle(version) }}
							</span>
							<span class="block truncate pt-0.5 text-xs text-ink-gray-5">
								{{ versionMeta(version) }}
							</span>
						</span>
					</button>
				</section>
				<div v-if="history.data?.more" class="flex px-2 pt-3">
					<Button variant="ghost" :loading="history.loading" @click="showMore">
						{{ __('Show more') }}
					</Button>
				</div>
			</template>
		</ScrollArea>
	</aside>
</template>

<script setup>
import { versionAction, versionTitle } from '@/lib/versionHistory';
import {
	Avatar,
	Button,
	ScrollArea,
	Skeleton,
	TabButtons,
	Tooltip,
	createResource,
	dayjsLocal,
} from 'frappe-ui';
import { computed, shallowRef, watch } from 'vue';

const PAGE_SIZE = 50;

const props = defineProps({
	spaceId: { type: String, required: true },
	docKey: { type: String, default: null },
});

const scope = defineModel('scope', { type: String, default: 'page' });
const selected = defineModel('selected', { type: Object, default: null });
const emit = defineEmits(['close']);

const scopeOptions = [
	{ value: 'page', label: __('This page') },
	{ value: 'space', label: __('Space') },
];

function makeHistory(limit) {
	const isPage = scope.value === 'page';
	return createResource({
		url: isPage
			? 'wiki.api.history.get_page_history'
			: 'wiki.api.history.get_space_history',
		method: 'GET',
		params: isPage
			? { wiki_space: props.spaceId, doc_key: props.docKey, limit }
			: { wiki_space: props.spaceId, limit },
		cache: ['version-history', scope.value, props.spaceId, props.docKey, limit],
		auto: true,
	});
}

const history = shallowRef(null);
watch(
	[scope, () => props.spaceId, () => props.docKey],
	() => {
		history.value = makeHistory(PAGE_SIZE);
	},
	{ immediate: true },
);

// Asks for a longer list rather than the next page, so the cache keeps one entry per length.
function showMore() {
	history.value = makeHistory(versions.value.length + PAGE_SIZE);
}

const versions = computed(() => history.value?.data?.versions ?? []);

watch(scope, () => {
	selected.value = null;
});

const groups = computed(() => {
	const byLabel = new Map();
	for (const version of versions.value) {
		const label = dayLabel(version.created_at);
		byLabel.set(label, [...(byLabel.get(label) ?? []), version]);
	}
	return [...byLabel].map(([label, versions]) => ({ label, versions }));
});

function dayLabel(value) {
	const date = dayjsLocal(value);
	const today = dayjsLocal();
	if (date.isSame(today, 'day')) return __('Today');
	if (date.isSame(today.subtract(1, 'day'), 'day')) return __('Yesterday');
	if (date.isAfter(today.subtract(7, 'day'))) return __('This week');
	return __('Earlier');
}

const CHANGE_LABELS = {
	added: () => __('added'),
	deleted: () => __('deleted'),
	renamed: (version) => __('renamed from {0}', [version.old_title]),
	moved: () => __('moved'),
	edited: () => __('edited'),
	published: () => __('published'),
	unpublished: () => __('unpublished'),
};

function versionMeta(version) {
	const date = dayjsLocal(version.created_at);
	const when = date.isSame(dayjsLocal(), 'day')
		? date.format('h:mm A')
		: date.format('D MMM, h:mm A');
	return `${when} · ${scope.value === 'space' ? pageCount(version) : changeSummary(version)}`;
}

function pageCount(version) {
	return version.page_count === 1
		? __('1 page')
		: __('{0} pages', [version.page_count]);
}

function changeSummary(version) {
	return version.changes
		.map((change) => CHANGE_LABELS[change](version))
		.join(', ');
}
</script>
