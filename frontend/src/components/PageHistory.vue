<template>
	<div class="flex flex-col h-full">
		<!-- Header -->
		<div class="flex items-center gap-4 p-3 sm:p-4 border-b border-outline-gray-2 bg-surface-white shrink-0">
			<Button variant="ghost" icon-left="arrow-left" @click="goBack">
				{{ __('Back') }}
			</Button>
			<div class="min-w-0">
				<h1 class="text-xl font-semibold text-ink-gray-9 truncate">
					{{ pageTitle }}
				</h1>
				<p class="text-sm text-ink-gray-5">{{ __('Version history') }}</p>
			</div>
		</div>

		<!-- Master–detail -->
		<div class="flex-1 min-h-0 flex flex-col lg:flex-row">
			<!-- List -->
			<aside class="w-full lg:w-[360px] shrink-0 border-b lg:border-b-0 lg:border-r border-outline-gray-2 overflow-auto bg-surface-gray-1">
				<!-- Loading -->
				<div v-if="history.loading && !history.data" class="p-3 space-y-2 animate-pulse">
					<div v-for="n in 5" :key="n" class="flex items-center gap-3 p-3">
						<div class="size-8 rounded-full bg-surface-gray-3 shrink-0" />
						<div class="flex-1 space-y-2">
							<div class="h-3 w-2/3 rounded bg-surface-gray-3" />
							<div class="h-3 w-1/3 rounded bg-surface-gray-3" />
						</div>
					</div>
				</div>

				<!-- Error -->
				<div v-else-if="history.error" class="p-6 text-sm text-ink-gray-6">
					{{ historyErrorMessage }}
				</div>

				<!-- List -->
				<ul v-else-if="history.data?.length" class="divide-y divide-outline-gray-2">
					<li
						v-for="entry in history.data"
						:key="entry.revision"
						class="flex items-start gap-3 p-3 cursor-pointer hover:bg-surface-gray-2"
						:class="{ 'bg-surface-gray-3': entry.revision === selectedRevision }"
						@click="selectRevision(entry.revision)"
					>
						<Avatar
							shape="circle"
							size="lg"
							:image="entry.author?.user_image"
							:label="entry.author?.full_name"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<Badge variant="subtle" :theme="changeTheme(entry.change_type)" size="sm">
									{{ changeLabel(entry.change_type) }}
								</Badge>
								<span class="text-xs text-ink-gray-5 truncate" :title="fullTime(entry.timestamp)">
									{{ timeAgo(entry.timestamp) }}
								</span>
							</div>
							<p class="mt-1 text-sm text-ink-gray-8 truncate">
								{{ entry.author?.full_name }}
							</p>
							<button
								v-if="entry.change_request"
								type="button"
								class="mt-0.5 text-sm text-blue-600 hover:underline truncate block text-left w-full"
								:title="entry.cr_title || entry.change_request"
								@click.stop="openChangeRequest(entry.change_request)"
							>
								{{ entry.cr_title || entry.change_request }}
							</button>
							<p
								v-else-if="entry.message"
								class="mt-0.5 text-sm text-ink-gray-5 truncate"
								:title="entry.message"
							>
								{{ entry.message }}
							</p>
						</div>
					</li>
				</ul>

				<!-- No history at all (shouldn't happen for a live page, but stay safe) -->
				<div v-else class="p-6 text-sm text-ink-gray-5">
					{{ __('No version history for this page.') }}
				</div>
			</aside>

			<!-- Detail -->
			<section class="flex-1 min-w-0 overflow-auto p-4">
				<div v-if="selectedRevision">
					<!-- First-version note -->
					<div
						v-if="currentDiff && !currentDiff.base"
						class="mb-4 p-3 rounded-lg bg-surface-gray-2 text-sm text-ink-gray-6"
					>
						{{ __('No earlier versions of this page yet.') }}
					</div>

					<div class="flex items-center justify-end gap-1 mb-3">
						<Button
							size="sm"
							:variant="diffStyle === 'split' ? 'subtle' : 'ghost'"
							@click="diffStyle = 'split'"
						>
							{{ __('Split') }}
						</Button>
						<Button
							size="sm"
							:variant="diffStyle === 'unified' ? 'subtle' : 'ghost'"
							@click="diffStyle = 'unified'"
						>
							{{ __('Unified') }}
						</Button>
					</div>

					<div v-if="diffLoading" class="flex items-center justify-center py-16">
						<LoadingIndicator class="size-6" />
					</div>
					<div v-else-if="currentDiff" class="relative z-0 isolate">
						<DiffViewer
							:old-content="currentDiff.base?.content || ''"
							:new-content="currentDiff.head?.content || ''"
							:file-name="currentDiff.head?.title || currentDiff.base?.title || pageTitle"
							:diff-style="diffStyle"
							language="markdown"
						/>
					</div>
					<div v-else class="py-16 text-center text-sm text-ink-gray-5">
						{{ __('Could not load this diff.') }}
					</div>
				</div>

				<!-- Detail loading placeholder before the list resolves -->
				<div v-else-if="history.loading" class="flex items-center justify-center py-16">
					<LoadingIndicator class="size-6" />
				</div>
			</section>
		</div>
	</div>
</template>

<script setup>
import DiffViewer from '@/components/DiffViewer.vue';
import {
	Avatar,
	Badge,
	Button,
	LoadingIndicator,
	createResource,
	usePageMeta,
} from 'frappe-ui';
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
	spaceId: {
		type: String,
		required: true,
	},
	pageId: {
		type: String,
		required: true,
	},
});

const router = useRouter();

// Change-type badge themes are defined by the spec (added=green, edited=blue,
// renamed=gray, deleted=red) — distinct from the CR-review change vocabulary, so
// kept local rather than reusing useChangeTypeDisplay.
const CHANGE_TYPES = {
	added: { theme: 'green', label: __('Added') },
	edited: { theme: 'blue', label: __('Edited') },
	renamed: { theme: 'gray', label: __('Renamed') },
	deleted: { theme: 'red', label: __('Deleted') },
};

function changeTheme(type) {
	return CHANGE_TYPES[type]?.theme || 'gray';
}
function changeLabel(type) {
	return CHANGE_TYPES[type]?.label || type;
}

// Newest history entry carries the page's current title — no extra document
// fetch needed just for the header.
const pageTitle = computed(() => history.data?.[0]?.title || __('Page'));

usePageMeta(() => ({ title: `${pageTitle.value} | ${__('Version history')}` }));

const history = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_revision.history.get_page_history',
	params: { page: props.pageId },
	auto: true,
	onSuccess: (data) => {
		// Auto-select the newest revision (the list is newest-first).
		if (data?.length) selectRevision(data[0].revision);
	},
});

const historyErrorMessage = computed(
	() => history.error?.messages?.[0] || __('Could not load version history.'),
);

const selectedRevision = ref(null);
const diffStyle = ref('split');

// Diffs are immutable per revision, so cache them and never refetch.
const diffCache = reactive({});
const diffLoading = ref(false);

const diffResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_revision.history.diff_page_revisions',
});

const currentDiff = computed(() =>
	selectedRevision.value ? diffCache[selectedRevision.value] : null,
);

async function selectRevision(revision) {
	selectedRevision.value = revision;
	if (diffCache[revision]) return;
	diffLoading.value = true;
	try {
		const result = await diffResource.submit({
			page: props.pageId,
			revision,
		});
		diffCache[revision] = result;
	} catch (error) {
		// Leave the cache empty; the detail pane shows a load-failure note.
		console.error('Error loading page diff:', error);
	} finally {
		// A newer selection may have started while this was in flight; only clear
		// the spinner when we're still the active revision.
		if (selectedRevision.value === revision) diffLoading.value = false;
	}
}

function goBack() {
	router.push({
		name: 'SpacePage',
		params: { spaceId: props.spaceId, pageId: props.pageId },
	});
}

function openChangeRequest(changeRequestId) {
	router.push({ name: 'ChangeRequestReview', params: { changeRequestId } });
}

// --- Time formatting ---------------------------------------------------------

const RELATIVE_UNITS = [
	['year', 31536000],
	['month', 2592000],
	['week', 604800],
	['day', 86400],
	['hour', 3600],
	['minute', 60],
];

function parseTs(ts) {
	// Frappe timestamps are "YYYY-MM-DD HH:mm:ss"; make it ISO for the parser.
	return ts ? new Date(ts.replace(' ', 'T')) : null;
}

function timeAgo(ts) {
	const then = parseTs(ts);
	if (!then || Number.isNaN(then.getTime())) return '';
	const seconds = Math.round((Date.now() - then.getTime()) / 1000);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	for (const [unit, span] of RELATIVE_UNITS) {
		if (Math.abs(seconds) >= span) {
			return rtf.format(-Math.round(seconds / span), unit);
		}
	}
	return rtf.format(0, 'second');
}

function fullTime(ts) {
	const then = parseTs(ts);
	if (!then || Number.isNaN(then.getTime())) return '';
	return then.toLocaleString();
}

// Defensive: if the router ever reuses this instance across a pageId change
// (normally it remounts), reset selection/cache and refetch for the new page.
watch(
	() => props.pageId,
	(pageId) => {
		selectedRevision.value = null;
		for (const key in diffCache) delete diffCache[key];
		history.submit({ page: pageId });
	},
);
</script>

