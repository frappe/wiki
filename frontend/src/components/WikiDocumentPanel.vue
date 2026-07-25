<template>
	<div class="h-full flex flex-col">
		<DefineActions>
			<Button
				v-if="wikiDoc.doc?.is_published"
				variant="ghost"
				@click="openPage"
			>
				<template #prefix>
					<span class="lucide-external-link size-4" aria-hidden="true" />
				</template>
				{{ __('View Page') }}
			</Button>
			<Button
				v-if="!readonly"
				variant="solid"
				:loading="isSaving"
				:title="isMac ? '⌘S' : 'Ctrl+S'"
				@click="saveFromHeader"
			>
				{{ __('Save') }}
			</Button>
			<Dropdown :options="menuOptions">
				<Button variant="ghost" :title="__('More actions')">
					<span class="lucide-more-vertical size-4" aria-hidden="true" />
				</Button>
			</Dropdown>
		</DefineActions>

		<!-- Page actions live in the space's tab row (SpaceDetails). `defer` lets
		     that target mount first when tabs load async. -->
		<Teleport defer to="#wiki-page-actions">
			<ReuseActions />
		</Teleport>

		<div v-if="wikiDoc.doc" class="h-full flex flex-col">
			<div class="flex-1 overflow-auto pb-10">
				<WikiEditor v-if="editorKey" :key="editorKey" ref="editorRef" :content="editorContent" :document-key="wikiDoc.doc?.doc_key" :saved-content="savedContent" :readonly="readonly" @save="saveContent" @save-all="flushOtherDirtyPages" @content-change="onEditorContentChange" @content-ready="onEditorContentReady">
					<template #title>
						<div class="pt-8">
							<div class="flex items-start gap-3">
								<input
									type="text"
									v-model="editableTitle"
									:readonly="readonly"
									class="text-3xl-semibold text-ink-gray-9 bg-transparent border-none outline-none w-full min-w-0 flex-1 focus:ring-0 p-0 placeholder:text-ink-gray-4"
									:placeholder="__('Page title')"
									@blur="saveTitleIfChanged"
									@keydown.enter="$event.target.blur()"
								/>
								<div class="flex shrink-0 items-center gap-2 pt-2">
									<Badge v-if="displayPublished" variant="subtle" theme="green" size="sm">
										{{ __('Published') }}
									</Badge>
									<Badge v-else variant="subtle" theme="orange" size="sm">
										{{ __('Not Published') }}
									</Badge>
									<Badge v-if="!readonly && hasChangeForCurrentPage" variant="subtle" theme="blue" size="sm">
										{{ __('Has Draft Changes') }}
									</Badge>
								</div>
							</div>

							<!-- Route under the title; click-to-edit unless read-only. -->
							<div
								class="mt-2 flex items-center gap-1 text-sm text-ink-gray-5"
								:class="readonly ? '' : 'cursor-pointer hover:text-ink-gray-7 group/route w-fit'"
								@click="readonly ? null : openRouteDialog()"
							>
								<span class="font-mono truncate">/{{ displayRoute }}</span>
								<span v-if="!readonly" class="lucide-pencil size-3 shrink-0 opacity-0 group-hover/route:opacity-100" aria-hidden="true" />
							</div>
						</div>
					</template>
				</WikiEditor>
				<!-- Editor body skeleton while the CR page overlay loads -->
				<div v-else class="mx-auto w-full max-w-[770px] space-y-4 px-6 pt-8">
					<Skeleton class="h-4 w-3/4 rounded" />
					<Skeleton class="h-4 w-full rounded" />
					<Skeleton class="h-4 w-5/6 rounded" />
					<Skeleton class="h-4 w-full rounded" />
					<Skeleton class="h-4 w-2/3 rounded" />
					<Skeleton class="h-4 w-full rounded mt-6" />
					<Skeleton class="h-4 w-4/5 rounded" />
					<Skeleton class="h-4 w-full rounded" />
					<Skeleton class="h-4 w-3/4 rounded" />
				</div>
			</div>
		</div>

		<!-- Content skeleton -->
		<div v-else class="h-full flex flex-col">
			<div class="flex min-h-12 shrink-0 items-center justify-between border-b border-outline-gray-2 px-3 sm:px-5">
				<Skeleton class="h-4 w-40 rounded" />
				<div class="flex items-center gap-2">
					<Skeleton class="h-8 w-24 rounded" />
					<Skeleton class="h-8 w-16 rounded" />
					<Skeleton class="size-8 rounded" />
				</div>
			</div>
			<div class="mx-auto w-full max-w-[770px] flex-1 px-6 pb-6 pt-8 space-y-4">
				<Skeleton class="h-8 w-64 rounded" />
				<Skeleton class="h-5 w-24 rounded-full" />
				<Skeleton class="h-4 w-3/4 rounded" />
				<Skeleton class="h-4 w-full rounded" />
				<Skeleton class="h-4 w-5/6 rounded" />
				<Skeleton class="h-4 w-full rounded" />
				<Skeleton class="h-4 w-2/3 rounded" />
				<Skeleton class="h-4 w-full rounded mt-6" />
				<Skeleton class="h-4 w-4/5 rounded" />
				<Skeleton class="h-4 w-full rounded" />
				<Skeleton class="h-4 w-3/4 rounded" />
			</div>
		</div>
		<Dialog v-model:open="showRouteDialog" size="sm">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">{{ __('Edit Route') }}</h3>
			</template>
			<template #default>
				<FormControl
					v-model="editableRoute"
					:label="__('Route')"
					type="text"
					:placeholder="__('page-route')"
				/>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="isSavingRoute" @click="saveRoute(close)">
						{{ __('Update') }}
					</Button>
				</div>
			</template>
		</Dialog>
		<PageSettings v-if="wikiDoc.doc" v-model="showPageSettingsDialog" :doc-resource="wikiDoc" />
	</div>
</template>

<script setup>
import { buildGithubEditUrl } from '@/lib/github';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useUserStore } from '@/stores/user';
import {
	Badge,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	Skeleton,
	createDocumentResource,
	getCachedDocumentResource,
	toast,
	usePageMeta,
} from 'frappe-ui';
import { createReusableTemplate } from '@vueuse/core';
import { computed, ref, shallowRef, watch } from 'vue';
import PageSettings from './PageSettings.vue';
import WikiEditor from './WikiEditor.vue';

const isMac = computed(() => /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));

const [DefineActions, ReuseActions] = createReusableTemplate();

const props = defineProps({
	pageId: {
		type: String,
		required: true,
	},
	spaceId: {
		type: String,
		required: false,
	},
	// Git-synced space: the page is owned by the repo. Render it for reading
	// only — no change request, no editing affordances, no save path.
	readonly: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['refresh']);

const editorRef = ref(null);
const editableTitle = ref('');
const editableRoute = ref('');
const showRouteDialog = ref(false);
const isSavingRoute = ref(false);
const showPageSettingsDialog = ref(false);

const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const userStore = useUserStore();

// frappe-ui caches document resources by (doctype, name), so revisiting an
// already-opened page renders instantly from the cached doc while `auto`
// kicks off a background revalidation (stale-while-revalidate). One resource
// per page — mutating a shared resource's `name` would block on the refetch.
function makeWikiDocResource(pageId) {
	return createDocumentResource({
		doctype: 'Wiki Document',
		name: pageId,
		auto: true,
	});
}

const wikiDoc = shallowRef(makeWikiDocResource(props.pageId));

const currentCrPage = ref(null);
const loadedDocKey = ref(null);
let latestPageLoad = 0;

watch(
	() => props.pageId,
	(newPageId) => {
		if (newPageId) {
			latestPageLoad += 1;
			currentCrPage.value = null;
			loadedDocKey.value = null;
			wikiDoc.value = makeWikiDocResource(newPageId);
		}
	},
);

watch(
	[() => crStore.currentChangeRequest?.name, () => wikiDoc.value.doc?.doc_key],
	async ([crName, docKey], [oldCrName]) => {
		// Read-only (git-synced) pages render straight from the published doc —
		// no change request overlay, so skip the CR-page load entirely.
		if (props.readonly) return;
		if (docKey) {
			// Navigation cancels the previous page's debounced autosave;
			// flush its buffer now. Failures surface via the sync pill.
			draftStore.flushDirtyPages(docKey).catch(() => {});
			await loadCrPage();
		} else {
			currentCrPage.value = null;
			loadedDocKey.value = null;
		}
		// After merge/archive, the CR name changes — reload wikiDoc to get updated route etc.
		if (oldCrName && crName !== oldCrName) {
			wikiDoc.value.reload();
		}
	},
	{ immediate: true },
);

function onEditorContentChange(
	content,
	docKey = wikiDoc.value.doc?.doc_key,
	options = {},
) {
	if (props.readonly) return;
	if (!docKey) return;
	const title = draftStore.pagesByKey[docKey]?.title ?? editableTitle.value;
	draftStore.recordEditorContent(docKey, content, title, options);
}

function onEditorContentReady(
	content,
	savedContent,
	docKey = wikiDoc.value.doc?.doc_key,
) {
	if (props.readonly) return;
	if (!docKey) return;
	const title = draftStore.pagesByKey[docKey]?.title ?? editableTitle.value;
	draftStore.reconcileEditorContent(docKey, content, savedContent, title);
}

async function loadCrPage() {
	const docKey = wikiDoc.value.doc?.doc_key;
	const pageLoad = ++latestPageLoad;
	if (!docKey) {
		currentCrPage.value = null;
		loadedDocKey.value = null;
		return;
	}
	if (
		props.spaceId &&
		draftStore.isEnabled &&
		(draftStore.spaceId !== props.spaceId ||
			draftStore.isHydrating ||
			!crStore.currentChangeRequest)
	) {
		await draftStore.hydrate(props.spaceId);
	}
	const page = crStore.currentChangeRequest
		? await draftStore.loadCrPage(docKey)
		: null;
	if (pageLoad === latestPageLoad && wikiDoc.value.doc?.doc_key === docKey) {
		currentCrPage.value = page;
		loadedDocKey.value = docKey;
	}
}

const activePage = computed(() => {
	const docKey = wikiDoc.value.doc?.doc_key;
	return docKey ? draftStore.pagesByKey[docKey] : null;
});

const hasChangeForCurrentPage = computed(() => {
	const docKey = wikiDoc.value.doc?.doc_key;
	if (!docKey) return false;
	return Boolean(crStore.changes.some((change) => change.doc_key === docKey));
});

const editorContent = computed(() => {
	if (activePage.value?.localContent != null) {
		return activePage.value.localContent;
	}
	if (activePage.value?.content != null) {
		return activePage.value.content;
	}
	if (currentCrPage.value?.content != null) {
		return currentCrPage.value.content;
	}
	return wikiDoc.value.doc?.content || '';
});

const displayTitle = computed(() => {
	return (
		activePage.value?.title ||
		currentCrPage.value?.title ||
		wikiDoc.value.doc?.title ||
		''
	);
});

const displayPublished = computed(() => {
	if (activePage.value?.isPublished != null) {
		return Boolean(activePage.value.isPublished);
	}
	if (currentCrPage.value?.is_published != null) {
		return Boolean(currentCrPage.value.is_published);
	}
	return Boolean(wikiDoc.value.doc?.is_published);
});

const displayRoute = computed(() => {
	return (
		activePage.value?.route ||
		currentCrPage.value?.route ||
		wikiDoc.value.doc?.route ||
		''
	);
});

// Browser tab title: "{page} | {space}". Returning undefined while the doc
// is still loading keeps the previous title instead of flashing a blank one.
usePageMeta(() => {
	const title = displayTitle.value;
	if (!title) return;
	const space = props.spaceId
		? getCachedDocumentResource('Wiki Space', props.spaceId)
		: null;
	return { title: [title, space?.doc?.space_name].filter(Boolean).join(' | ') };
});

watch(
	displayTitle,
	(newTitle) => {
		editableTitle.value = newTitle;
	},
	{ immediate: true },
);

// Save state lives on the workspace store entry keyed by
// the published doc's CR overlay key. Until the user saves once, no entry
// exists and we report 'idle'.
const pageSaveStatus = computed(() => {
	const docKey = wikiDoc.value.doc?.doc_key;
	if (!docKey) return 'idle';
	return draftStore.pagesByKey[docKey]?.saveStatus || 'idle';
});
const isSaving = computed(() => pageSaveStatus.value === 'saving');
// Confirmed content the editor normalizes before handing both snapshots back
// to the store. Falls back to editorContent before an overlay entry exists.
const savedContent = computed(() => {
	const stored = activePage.value?.content;
	if (stored != null) return stored;
	return editorContent.value;
});

const editorKey = computed(() => {
	// Read-only pages have no CR overlay to wait for: mount the viewer as soon
	// as the published doc for this page is loaded.
	if (props.readonly) {
		return wikiDoc.value.doc?.name === props.pageId ? props.pageId : null;
	}
	// Gate on the loaded overlay matching the current doc — NOT on
	// `isLoadingCrPage`. A background revalidation (after a save / title /
	// route / publish edit) flips that flag without changing the page, and
	// keying off it would tear down and remount the live editor mid-edit.
	// `loadedDocKey` is reset on a real page switch, which is what should
	// actually remount the editor.
	if (
		wikiDoc.value.doc?.name === props.pageId &&
		wikiDoc.value.doc?.doc_key === loadedDocKey.value
	) {
		return props.pageId;
	}
	return null;
});

// "Edit on GitHub" target for a synced page — built from the space's repo/branch
// and the document's source_path. Null for non-synced spaces or folder-only
// groups (no editable source file). The space resource is the one SpaceDetails
// already loaded, so this reads from cache.
const githubEditUrl = computed(() => {
	const space = props.spaceId
		? getCachedDocumentResource('Wiki Space', props.spaceId)
		: null;
	if (!space?.doc?.git_synced) return null;
	return buildGithubEditUrl({
		repoFullName: space.doc.repo_full_name,
		branch: space.doc.branch,
		sourcePath: wikiDoc.value.doc?.source_path,
	});
});

const menuOptions = computed(() => {
	// Read-only spaces can't change publish state — only offer the desk link.
	const options = props.readonly
		? []
		: [
				{
					label: displayPublished.value ? __('Unpublish') : __('Publish'),
					icon: 'upload-cloud',
					onClick: togglePublish,
				},
				{
					label: __('Page settings'),
					icon: 'settings',
					onClick: () => {
						showPageSettingsDialog.value = true;
					},
				},
			];
	if (githubEditUrl.value) {
		options.push({
			label: __('Edit on GitHub'),
			icon: 'github',
			onClick: () => window.open(githubEditUrl.value, '_blank', 'noopener'),
		});
	}
	if (userStore.isWikiManager && wikiDoc.value.doc?.name) {
		options.push({
			label: __('View in Desk'),
			icon: 'external-link',
			onClick: () =>
				window.open(
					`/app/wiki-document/${encodeURIComponent(wikiDoc.value.doc.name)}`,
					'_blank',
				),
		});
	}
	return options;
});

async function saveTitleIfChanged() {
	if (props.readonly) return;
	const newTitle = editableTitle.value.trim();
	if (!newTitle || newTitle === displayTitle.value) return;
	if (!wikiDoc.value.doc?.doc_key) return;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, { title: newTitle });
		await loadCrPage();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating title'));
	}
}

function openRouteDialog() {
	editableRoute.value = displayRoute.value;
	showRouteDialog.value = true;
}

async function saveRoute(close) {
	const newRoute = editableRoute.value.trim().replace(/^\/+/, '');
	if (!newRoute || newRoute === displayRoute.value) {
		close();
		return;
	}
	if (!wikiDoc.value.doc?.doc_key) return;
	isSavingRoute.value = true;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, { route: newRoute });
		await loadCrPage();
		close();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating route'));
	} finally {
		isSavingRoute.value = false;
	}
}

async function togglePublish() {
	if (!wikiDoc.value.doc?.doc_key) return;
	const newStatus = displayPublished.value ? 0 : 1;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, {
			is_published: newStatus,
		});
		await loadCrPage();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating publish status'));
	}
}

function openPage() {
	window.open(`/${wikiDoc.value.doc.route}`, '_blank');
}

function saveFromHeader() {
	editorRef.value?.saveToDB();
}

// Drain dirty buffers for pages other than the one on screen; the open
// page's saves go through the editor instead.
async function flushOtherDirtyPages() {
	if (props.readonly) return;
	const failures = await draftStore.flushDirtyPages(wikiDoc.value.doc?.doc_key);
	if (failures.length) {
		const error = failures[0];
		toast.error(
			error?.messages?.[0] || error?.message || __('Error saving draft'),
		);
	}
}

async function saveContent(content) {
	if (props.readonly) return;
	if (!wikiDoc.value.doc?.doc_key) {
		toast.error(__('No active change request'));
		return;
	}

	try {
		await draftStore.saveContent(
			wikiDoc.value.doc.doc_key,
			content,
			editableTitle.value,
		);
		// Refresh the CR overlay snapshot so the panel's title/route/etc.
		// stay in sync with the change we just wrote. Inline failure UX
		// lands in task #7.
		await loadCrPage();
	} catch (error) {
		console.error('Error saving change request:', error);
		toast.error(
			error.messages?.[0] || error.message || __('Error saving draft'),
		);
	}
}
</script>
