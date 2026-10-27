<template>
	<div class="h-full flex flex-col">
		<div v-if="wikiDoc.doc" class="h-full flex flex-col">
			<!-- The page's one action row: where it sits in the tree on the
			     left, what you can do with it on the right. A synced page is
			     owned by the repo, so it offers the round trip to GitHub
			     instead of an edit flow. -->
			<div class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-2 px-3 sm:px-5">
				<div class="flex min-w-0 flex-1 items-center gap-1">
					<Breadcrumbs :items="breadcrumbs" class="min-w-0" />
					<Tooltip v-if="displayPublished" :text="__('Open live page')">
						<Button
							variant="ghost"
							size="sm"
							class="shrink-0 text-ink-gray-5"
							:aria-label="__('Open live page')"
							@click="openPage"
						>
							<span class="lucide-external-link size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<Badge v-if="readonly" variant="subtle" theme="gray" size="sm">
						{{ __('Read-only') }}
					</Badge>
					<Button
						v-if="readonly && githubEditUrl"
						variant="outline"
						@click="openGithubEdit"
					>
						<template #prefix>
							<span class="lucide-pencil size-4" aria-hidden="true" />
						</template>
						{{ __('Edit on GitHub') }}
					</Button>
					<Button
						v-if="spaceStore.isReading"
						variant="subtle"
						@click="editPage"
						@mouseenter="loadEditor"
						@focus="loadEditor"
					>
						<template #prefix>
							<span class="lucide-pencil size-4" aria-hidden="true" />
						</template>
						{{ __('Edit') }}
					</Button>
					<div class="flex items-center gap-1">
						<Tooltip v-if="!spaceStore.isGitSynced" :text="changeRequestsLabel">
							<Button
								:variant="openPanel === 'change-requests' ? 'subtle' : 'ghost'"
								:aria-label="changeRequestsLabel"
								:aria-pressed="openPanel === 'change-requests'"
								@click="toggleChangeRequests"
							>
								<template #prefix>
									<span class="relative inline-flex">
										<span class="lucide-git-pull-request size-4" aria-hidden="true" />
										<span
											v-if="pageChangeRequests.length"
											class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-surface-blue-5"
											aria-hidden="true"
										/>
									</span>
								</template>
								{{ pageChangeRequests.length }}
							</Button>
						</Tooltip>
						<Tooltip :text="__('Version history')">
							<Button
								:variant="openPanel === 'history' ? 'subtle' : 'ghost'"
								:aria-label="__('Version history')"
								:aria-pressed="openPanel === 'history'"
								@click="toggleHistory"
							>
								<span class="lucide-history size-4" aria-hidden="true" />
							</Button>
						</Tooltip>
						<!-- Shown for a synced page too: its meta title, description and
						     social card are wiki-side fields the repo never carries, so
						     they are still this app's to edit. -->
						<Tooltip :text="__('Page settings')">
							<Button
								:variant="showPageSettings ? 'subtle' : 'ghost'"
								:aria-label="__('Page settings')"
								:aria-pressed="showPageSettings"
								@click="toggleSidePanel('settings')"
							>
								<span class="lucide-settings-2 size-4" aria-hidden="true" />
							</Button>
						</Tooltip>
					</div>
					<!-- Each button decides its own visibility; empty:hidden drops the divider when none show. -->
					<div class="ml-1 flex items-center gap-2 border-l border-outline-gray-2 pl-3 empty:hidden">
						<!-- The phone header has no room for it; the strip above carries it. -->
						<MergeChangeRequestButton v-if="!isMobile" />
						<SubmitForReviewButton />
						<FinishEditingButton />
					</div>
					<Dropdown v-if="menuOptions.length" :options="menuOptions">
						<Button
							variant="ghost"
							:title="__('Page actions')"
							:aria-label="__('Page actions')"
						>
							<span class="lucide-more-horizontal size-4" aria-hidden="true" />
						</Button>
					</Dropdown>
				</div>
			</div>
			<!-- The panel takes the right edge of the row, so the scroller it
			     sits beside is narrower than the window — which is what the
			     editor measures to decide between the outline's two variants. -->
			<div class="relative flex min-h-0 flex-1">
				<!-- The one scroller on this page: the editor body scrolls under
				     the sticky toolbar, and the bubble menu and the outline rail
				     both measure against it. -->
				<!-- Hidden, not unmounted, so an open editor keeps its state behind a version's diff. -->
				<ScrollArea v-show="!selectedVersion" class="min-h-0 flex-1" viewport-class="pb-10">
					<component :is="showsLivePage ? WikiPageReader : WikiEditor" v-if="editorKey" ref="editor" :key="editorKey" v-bind="pageViewProps" @save="saveContent" @save-all="flushOtherDirtyPages" @content-change="onEditorContentChange" @content-ready="onEditorContentReady">
						<template #title>
							<div class="pt-10">
								<div class="flex items-start gap-3">
									<input
										type="text"
										v-model="editableTitle"
										:readonly="!isEditing"
										class="text-3xl-semibold text-ink-gray-9 bg-transparent border-none outline-none w-full min-w-0 flex-1 focus:ring-0 p-0 placeholder:text-ink-gray-4"
										:placeholder="__('Page title')"
										@blur="saveTitleIfChanged"
										@keydown.enter="$event.target.blur()"
									/>
									<!-- The only mark on the title: content has diverged from
									     the last confirmed save and autosave has yet to catch
									     up. Publish state and route are the settings panel's to
									     report, next to the fields that change them. -->
									<div class="flex shrink-0 items-center gap-2 pt-2">
										<span
											v-if="isPageDirty"
											class="size-2 rounded-full bg-surface-amber-4"
											:title="__('Unsaved changes')"
											:aria-label="__('Unsaved changes')"
											role="status"
										/>
									</div>
								</div>
								<PageMetaLine :key="wikiDoc.doc.name" :doc="wikiDoc.doc" :title="displayTitle" :content="editorContent" />
							</div>
						</template>
					</component>
					<!-- Editor body skeleton while the CR page overlay loads -->
					<div v-else class="mx-auto w-full max-w-3xl space-y-4 px-8 pt-10">
						<Skeleton class="h-4 w-3/4 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4" />
						<Skeleton class="h-4 w-5/6 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4" />
						<Skeleton class="h-4 w-2/3 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4 mt-6" />
						<Skeleton class="h-4 w-4/5 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4" />
						<Skeleton class="h-4 w-3/4 rounded-4" />
					</div>
				</ScrollArea>
				<VersionDiff
					v-if="selectedVersion"
					:space-id="spaceId"
					:version="selectedVersion"
					@back="selectedVersion = null"
				/>
				<PageSettingsPanel
					v-if="showPageSettings"
					class="max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:w-full bg-surface-base"
					:doc-resource="wikiDoc"
					:doc-key="wikiDoc.doc?.doc_key"
					:readonly="!isEditing"
					:title="displayTitle"
					:route="displayRoute"
					:published="displayPublished"
					:content="editorContent"
					@close="closeSidePanel"
				/>
				<Teleport defer to="#wiki-side-panel" :disabled="isMobile">
					<Transition
						enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
						enter-from-class="translate-x-6 opacity-0"
						leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
						leave-to-class="translate-x-6 opacity-0"
					>
						<div
							v-if="openPanel === 'change-requests' || openPanel === 'history'"
							class="flex max-md:absolute max-md:inset-0 max-md:z-10 max-md:bg-surface-base"
						>
							<ChangeRequestsPanel
								v-if="openPanel === 'change-requests'"
								class="max-md:w-full"
								:space-id="spaceId"
								:change-requests="changeRequests"
								@close="closeSidePanel"
							/>
							<HistoryPanel
								v-else
								v-model:selected="selectedVersion"
								class="max-md:w-full"
								:space-id="spaceId"
								@close="toggleHistory"
							/>
						</div>
					</Transition>
				</Teleport>
			</div>
		</div>

		<!-- Content skeleton -->
		<div v-else class="h-full flex flex-col">
			<div class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-2 px-3 sm:px-5">
				<Skeleton class="h-4 w-40 rounded-4" />
				<div class="ml-auto flex shrink-0 items-center gap-2">
					<Skeleton class="h-8 w-24 rounded-4" />
					<Skeleton class="h-8 w-16 rounded-4" />
					<Skeleton class="size-8 rounded-4" />
				</div>
			</div>
			<div class="mx-auto w-full max-w-3xl flex-1 px-8 pb-10 pt-10 space-y-4">
				<Skeleton class="h-8 w-64 rounded-4" />
				<Skeleton class="h-5 w-24 rounded-full" />
				<Skeleton class="h-4 w-3/4 rounded-4" />
				<Skeleton class="h-4 w-full rounded-4" />
				<Skeleton class="h-4 w-5/6 rounded-4" />
				<Skeleton class="h-4 w-full rounded-4" />
				<Skeleton class="h-4 w-2/3 rounded-4" />
				<Skeleton class="h-4 w-full rounded-4 mt-6" />
				<Skeleton class="h-4 w-4/5 rounded-4" />
				<Skeleton class="h-4 w-full rounded-4" />
				<Skeleton class="h-4 w-3/4 rounded-4" />
			</div>
		</div>
		<Dialog v-model:open="showRenameDialog" size="sm">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">{{ __('Rename Page') }}</h3>
			</template>
			<template #default>
				<FormControl
					v-model="editableRenameTitle"
					:label="__('Title')"
					type="text"
					:placeholder="__('Page title')"
				/>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="isRenaming" @click="renamePage(close)">
						{{ __('Rename') }}
					</Button>
				</div>
			</template>
		</Dialog>
		<Dialog v-model:open="showDeleteDialog" size="sm">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Delete') }} "{{ displayTitle || __('Untitled') }}"
				</h3>
			</template>
			<template #default>
				<p class="text-ink-gray-7">
					{{
						__(
							'The page is removed from the space when this change request is merged.',
						)
					}}
				</p>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						theme="red"
						:loading="isDeleting"
						@click="deletePage(close)"
					>
						{{ __('Save Delete Draft') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { useOpenChangeRequests } from '@/composables/useOpenChangeRequests';
import { useSidePanel } from '@/composables/useSidePanel';
import { useStartEditing } from '@/composables/useStartEditing';
import { buildGithubEditUrl } from '@/lib/github';
import { destructiveMenuOption } from '@/lib/menu';
import { SPACE_TREE_KEY, crumbRoute, trailToNode } from '@/lib/spaceTree';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useSpaceStore } from '@/stores/space';
import {
	Badge,
	Breadcrumbs,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	ScrollArea,
	Skeleton,
	Tooltip,
	createDocumentResource,
	createResource,
	getCachedDocumentResource,
	toast,
	usePageMeta,
} from 'frappe-ui';
import {
	computed,
	defineAsyncComponent,
	inject,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMobile } from '../composables/useMobile';
import { useRecentPages } from '../composables/useRecentPages';
import ChangeRequestsPanel from './ChangeRequestsPanel.vue';
import FinishEditingButton from './FinishEditingButton.vue';
import HistoryPanel from './HistoryPanel.vue';
import MergeChangeRequestButton from './MergeChangeRequestButton.vue';
import PageMetaLine from './PageMetaLine.vue';
import PageSettingsPanel from './PageSettingsPanel.vue';
import SubmitForReviewButton from './SubmitForReviewButton.vue';
import VersionDiff from './VersionDiff.vue';
import WikiPageReader from './WikiPageReader.vue';

const props = defineProps({
	pageId: {
		type: String,
		required: true,
	},
	spaceId: {
		type: String,
		required: false,
	},
	readonly: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['refresh']);

const editableTitle = ref('');
const showRenameDialog = ref(false);
const editableRenameTitle = ref('');
const isRenaming = ref(false);
const showDeleteDialog = ref(false);
const isDeleting = ref(false);
const selectedVersion = ref(null);

const route = useRoute();
const router = useRouter();
const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const { recordVisit } = useRecentPages();
const { request: startEditingRequest, requireEditing } = useStartEditing();
const { isMobile } = useMobile();

const isEditing = computed(() => spaceStore.isEditing);
const showsLivePage = computed(() => props.readonly || spaceStore.isReading);

const editor = useTemplateRef('editor');
const focusEditor = ref(false);

const editorReady = ref(false);
function loadEditor() {
	return import('./WikiEditor.vue').then((module) => {
		editorReady.value = true;
		return module;
	});
}
const WikiEditor = defineAsyncComponent(loadEditor);

watch(
	[isEditing, startEditingRequest],
	([editing, request]) => {
		if (editing || request) loadEditor();
	},
	{ immediate: true },
);

async function editPage() {
	// Set before the dialog closes: the editor often mounts while it is still leaving.
	focusEditor.value = true;
	if (!(await requireEditing())) {
		focusEditor.value = false;
		return;
	}
	if (editorKey.value?.startsWith('edit:')) editor.value?.focusEnd();
}

async function whenEditing(action) {
	if (await requireEditing()) action();
}

watch(
	[() => route.query.edit, () => spaceStore.canContribute],
	([edit, mayContribute]) => {
		if (!edit || mayContribute === null) return;
		router.replace({ query: { ...route.query, edit: undefined } });
		editPage();
	},
	{ immediate: true },
);

// frappe-ui caches document resources by (doctype, name), so revisiting an
// already-opened page renders instantly from the cached doc while `auto`
// kicks off a background revalidation (stale-while-revalidate). One resource
// per page — mutating a shared resource's `name` would block on the refetch.
function makeWikiDocResource(pageId) {
	return createDocumentResource({
		doctype: 'Wiki Document',
		name: pageId,
		auto: true,
		whitelistedMethods: { updateMeta: 'update_meta' },
	});
}

const wikiDoc = shallowRef(makeWikiDocResource(props.pageId));

function makePageHtmlResource(pageId) {
	return createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_document.wiki_document.get_page_html',
		method: 'GET',
		params: { name: pageId },
		cache: ['page-html', pageId],
		auto: true,
	});
}

const pageHtml = shallowRef(null);

watch(
	[() => props.pageId, isEditing],
	([pageId, editing]) => {
		if (!editing) pageHtml.value = makePageHtmlResource(pageId);
	},
	{ immediate: true },
);

watch(
	() => [wikiDoc.value.doc?.name, wikiDoc.value.doc?.modified],
	([name, modified], [previousName, previousModified]) => {
		if (name !== previousName || !previousModified) return;
		if (modified !== previousModified && !isEditing.value) {
			pageHtml.value?.reload();
		}
	},
);

const currentCrPage = ref(null);
const loadedDocKey = ref(null);
let latestPageLoad = 0;

watch(
	() => props.pageId,
	(newPageId) => {
		if (newPageId) {
			latestPageLoad += 1;
			selectedVersion.value = null;
			currentCrPage.value = null;
			loadedDocKey.value = null;
			focusEditor.value = false;
			wikiDoc.value = makeWikiDocResource(newPageId);
		}
	},
);

watch(
	[
		() => crStore.currentChangeRequest?.name,
		() => wikiDoc.value.doc?.doc_key,
		isEditing,
	],
	async ([, docKey, editing]) => {
		// Read mode renders straight from the published doc, with no change
		// request overlay. Dropping the overlay keeps the next Edit from
		// mounting this session's copy before its own loads.
		if (!editing || !docKey) {
			currentCrPage.value = null;
			loadedDocKey.value = null;
			return;
		}
		// Navigation cancels the previous page's debounced autosave;
		// flush its buffer now. Failures surface via the sync pill.
		draftStore.flushDirtyPages(docKey).catch(() => {});
		await loadCrPage();
	},
	{ immediate: true },
);

function onEditorContentChange(
	content,
	docKey = wikiDoc.value.doc?.doc_key,
	options = {},
) {
	if (!isEditing.value) return;
	if (!docKey) return;
	const title = draftStore.pagesByKey[docKey]?.title ?? editableTitle.value;
	draftStore.recordEditorContent(docKey, content, title, options);
}

function onEditorContentReady(
	content,
	savedContent,
	docKey = wikiDoc.value.doc?.doc_key,
) {
	if (!isEditing.value) return;
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
	// A git-synced space has no change request to hydrate — asking for one
	// answers 403, once per page opened.
	if (
		!props.readonly &&
		props.spaceId &&
		draftStore.isEnabled &&
		(draftStore.spaceId !== props.spaceId ||
			draftStore.isHydrating ||
			!crStore.currentChangeRequest)
	) {
		await draftStore.hydrateForPage(props.spaceId, docKey);
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

watch(
	[() => props.pageId, displayTitle, displayRoute],
	([pageId, title, route]) =>
		recordVisit({ name: pageId, title, space: props.spaceId, route }),
	{ immediate: true },
);

// The panel is module-scoped state: it stays open across page switches, and
// the toggles that own it live in this header.
const {
	openPanel,
	close: closeSidePanel,
	toggle: toggleSidePanel,
} = useSidePanel();
const showPageSettings = computed(() => openPanel.value === 'settings');

const {
	changeRequests,
	changingPage,
	reload: reloadChangeRequests,
} = useOpenChangeRequests(() => props.spaceId);
const pageChangeRequests = computed(() =>
	changingPage(wikiDoc.value.doc?.doc_key),
);
const changeRequestsLabel = computed(() =>
	__('{0} open on this page, {1} in this space', [
		pageChangeRequests.value.length,
		changeRequests.value.length,
	]),
);

function toggleHistory() {
	toggleSidePanel('history');
	if (openPanel.value !== 'history') selectedVersion.value = null;
}

// The panel covers the page on a phone, so it steps aside for the diff.
watch(selectedVersion, (version) => {
	if (version && isMobile.value) closeSidePanel();
});

// Another panel in the slot means the page is back on screen.
watch(openPanel, (panel) => {
	if (panel && panel !== 'history') selectedVersion.value = null;
});

function toggleChangeRequests() {
	toggleSidePanel('change-requests');
	if (openPanel.value === 'change-requests') reloadChangeRequests();
}

const spaceTree = inject(SPACE_TREE_KEY, null);

// Where the open page sits in the tree. The last crumb reads the title input
// rather than the saved title, so it keeps up with the keystroke instead of
// waiting for the blur that saves.
const breadcrumbs = computed(() => {
	const children = spaceTree?.value?.children;
	if (!children?.length) return [];

	const docKey = wikiDoc.value.doc?.doc_key;
	const trail = trailToNode(
		children,
		(node) =>
			(docKey && node.doc_key === docKey) ||
			node.document_name === props.pageId,
	);
	if (!trail) return [];

	return trail.map((node, i) => ({
		label:
			(i === trail.length - 1 ? editableTitle.value : node.title) ||
			__('Untitled'),
		route: crumbRoute(node, props.spaceId),
	}));
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

// Divergence between the editor buffer and the last confirmed save — the same
// test the store's finalization gate uses, read for this page alone.
const isPageDirty = computed(() => {
	const page = activePage.value;
	return Boolean(
		page?.localContent != null && page.localContent !== page.content,
	);
});
// Confirmed content the editor normalizes before handing both snapshots back
// to the store. Falls back to editorContent before an overlay entry exists.
const savedContent = computed(() => {
	const stored = activePage.value?.content;
	if (stored != null) return stored;
	return editorContent.value;
});

const editorKey = computed(() => {
	const doc = wikiDoc.value.doc;
	if (doc?.name !== props.pageId) return null;
	// The live page has no CR overlay to wait for. The viewer reads its content
	// once, so a revalidation that brings newer content remounts it.
	if (showsLivePage.value) return `read:${props.pageId}:${doc.modified}`;
	// Gate on the loaded overlay matching the current doc — NOT on
	// `isLoadingCrPage`. A background revalidation (after a save / title /
	// route / publish edit) flips that flag without changing the page, and
	// keying off it would tear down and remount the live editor mid-edit.
	// `loadedDocKey` is reset on a real page switch, which is what should
	// actually remount the editor.
	if (
		isEditing.value &&
		editorReady.value &&
		doc.doc_key === loadedDocKey.value
	) {
		return `edit:${props.pageId}`;
	}
	return null;
});

const pageViewProps = computed(() => {
	if (showsLivePage.value) {
		return {
			html: pageHtml.value?.data?.html ?? null,
			toc: pageHtml.value?.data?.toc ?? [],
			showOutline: !openPanel.value,
		};
	}
	return {
		content: editorContent.value,
		documentKey: wikiDoc.value.doc?.doc_key,
		savedContent: savedContent.value,
		autofocus: focusEditor.value,
		showOutline: !openPanel.value,
	};
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

// A synced page has no editable state here — the repo owns it, and the
// header already offers the trip to GitHub. In read mode each action asks for
// a change request first.
const menuOptions = computed(() => {
	if (!spaceStore.canEdit) return [];
	return [
		{
			group: __('Page'),
			hideLabel: true,
			options: [
				{
					label: __('Rename'),
					icon: 'lucide-pencil',
					onClick: () => whenEditing(openRenameDialog),
				},
				{
					label: displayPublished.value ? __('Unpublish') : __('Publish'),
					icon: 'lucide-upload-cloud',
					onClick: () => whenEditing(togglePublish),
				},
			],
		},
		{
			group: __('Danger'),
			hideLabel: true,
			options: [
				destructiveMenuOption({
					label: __('Delete'),
					icon: 'lucide-trash-2',
					onClick: () =>
						whenEditing(() => {
							showDeleteDialog.value = true;
						}),
				}),
			],
		},
	];
});

function openRenameDialog() {
	editableRenameTitle.value = displayTitle.value;
	showRenameDialog.value = true;
}

async function renamePage(close) {
	const newTitle = editableRenameTitle.value.trim();
	if (!newTitle || newTitle === displayTitle.value) {
		close();
		return;
	}
	if (!wikiDoc.value.doc?.doc_key) return;
	isRenaming.value = true;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, { title: newTitle });
		close();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating title'));
	} finally {
		isRenaming.value = false;
	}
}

function openGithubEdit() {
	if (!githubEditUrl.value) return;
	window.open(githubEditUrl.value, '_blank', 'noopener');
}

// Deleting the open page leaves the editor pointing at nothing, so hand the
// route back to the space, which reopens the next page it can find.
async function deletePage(close) {
	const docKey = wikiDoc.value.doc?.doc_key;
	if (!docKey) {
		close();
		return;
	}
	close();
	isDeleting.value = true;
	try {
		await draftStore.deleteNode(docKey);
		if (props.spaceId) {
			router.push({ name: 'SpaceDetails', params: { spaceId: props.spaceId } });
		}
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error creating draft'));
	} finally {
		isDeleting.value = false;
	}
}

async function saveTitleIfChanged() {
	if (!isEditing.value) return;
	const newTitle = editableTitle.value.trim();
	if (!newTitle || newTitle === displayTitle.value) return;
	if (!wikiDoc.value.doc?.doc_key) return;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, { title: newTitle });
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating title'));
	}
}

async function togglePublish() {
	if (!wikiDoc.value.doc?.doc_key) return;
	const newStatus = displayPublished.value ? 0 : 1;
	try {
		await draftStore.updateNode(wikiDoc.value.doc.doc_key, {
			is_published: newStatus,
		});
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating publish status'));
	}
}

function openPage() {
	window.open(`/${wikiDoc.value.doc.route}`, '_blank');
}

// Drain dirty buffers for pages other than the one on screen; the open
// page's saves go through the editor instead.
async function flushOtherDirtyPages() {
	if (!isEditing.value) return;
	const failures = await draftStore.flushDirtyPages(wikiDoc.value.doc?.doc_key);
	if (failures.length) {
		const error = failures[0];
		toast.error(
			error?.messages?.[0] || error?.message || __('Error saving draft'),
		);
	}
}

async function saveContent(content) {
	if (!isEditing.value) return;
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
	} catch (error) {
		// The sync alert says so and stays up; a toast per blocked autosave would not.
		if (error.code === 'version_conflict') return;
		console.error('Error saving change request:', error);
		toast.error(
			error.messages?.[0] || error.message || __('Error saving draft'),
		);
	}
}
</script>
