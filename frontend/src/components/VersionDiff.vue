<template>
	<div class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="version-diff">
		<div
			class="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-outline-gray-1 px-3 py-2 sm:px-5"
		>
			<Tooltip :text="__('Back to current version')">
				<Button
					variant="ghost"
					:aria-label="__('Back to current version')"
					@click="emit('back')"
				>
					<span class="lucide-arrow-left size-4" aria-hidden="true" />
				</Button>
			</Tooltip>
			<div class="min-w-0 flex-1">
				<p class="truncate text-base-medium text-ink-gray-8">{{ versionTitle(version) }}</p>
				<p class="truncate text-xs text-ink-gray-5">
					{{ version.author.full_name }} {{ versionAction(version) }} ·
					{{ dayjsLocal(version.created_at).fromNow() }}
				</p>
			</div>
			<Button
				v-if="version.change_request"
				variant="ghost"
				:aria-label="__('Open change request')"
				:route="{
					name: 'SpaceChangeRequest',
					params: { spaceId, changeRequestId: version.change_request },
				}"
			>
				<template #prefix>
					<span class="lucide-git-pull-request size-4" aria-hidden="true" />
				</template>
				<span class="max-sm:hidden">{{ __('Open change request') }}</span>
			</Button>
			<Button
				v-else-if="commitUrl"
				variant="ghost"
				:aria-label="__('View commit')"
				:href="commitUrl"
			>
				<template #prefix>
					<span class="lucide-git-commit-horizontal size-4" aria-hidden="true" />
				</template>
				<span class="max-sm:hidden">{{ __('View commit') }}</span>
			</Button>
			<Switch
				v-if="view !== 'markdown'"
				v-model="changesOnly"
				:label="__('Show changes only')"
			/>
			<TabButtons v-model="view" :options="viewOptions" />
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="mx-auto max-w-5xl space-y-4 px-4 pb-16 pt-5 sm:px-5">
				<div v-if="!changes.data" class="flex justify-center py-8">
					<LoadingIndicator class="size-8" />
				</div>
				<p
					v-else-if="!changes.data.pages.length"
					class="py-16 text-center text-base text-ink-gray-5"
				>
					{{ __('This version changed nothing on this page.') }}
				</p>
				<PageDiff
					v-for="page in changes.data?.pages"
					:key="page.doc_key"
					:page="page"
					:view="view"
					:changes-only="changesOnly"
				/>
			</div>
		</div>
	</div>
</template>

<script setup>
import { useDiffView } from '@/composables/useDiffView';
import { buildGithubCommitUrl } from '@/lib/github';
import { versionAction, versionTitle } from '@/lib/versionHistory';
import {
	Button,
	LoadingIndicator,
	Switch,
	TabButtons,
	Tooltip,
	createResource,
	dayjsLocal,
	getCachedDocumentResource,
} from 'frappe-ui';
import { computed, shallowRef, watch } from 'vue';
import PageDiff from './PageDiff.vue';

const props = defineProps({
	spaceId: { type: String, required: true },
	version: { type: Object, required: true },
	// Only this page's changes; every page the version changed when null.
	docKey: { type: String, default: null },
});

const emit = defineEmits(['back']);

const { view, changesOnly, viewOptions } = useDiffView();

const changes = shallowRef(null);
watch(
	[() => props.version.revision, () => props.docKey],
	([revision, docKey]) => {
		changes.value = createResource({
			url: 'wiki.api.history.get_revision_changes',
			method: 'GET',
			// A GET sends null as the string "null".
			params: docKey ? { revision, doc_key: docKey } : { revision },
			cache: ['version-changes', revision, docKey],
			auto: true,
		});
	},
	{ immediate: true },
);

const commitUrl = computed(() =>
	buildGithubCommitUrl(
		getCachedDocumentResource('Wiki Space', props.spaceId)?.doc?.repo_full_name,
		props.version.source_commit,
	),
);
</script>
