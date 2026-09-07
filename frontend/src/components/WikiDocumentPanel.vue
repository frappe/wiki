<template>
	<div class="h-full flex flex-col">
		<div v-if="wikiDoc.doc" class="h-full flex flex-col">
			<!-- The page's one action row: where it sits in the tree on the
			     left, what you can do with it on the right. A synced page is
			     owned by the repo, so it offers the round trip to GitHub
			     instead of an edit flow. -->
			<div class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-2 px-3 sm:px-5">
				<Breadcrumbs :items="breadcrumbs" class="min-w-0 flex-1" />
				<div class="flex shrink-0 items-center gap-2">
					<Badge v-if="readonly" variant="subtle" theme="gray" size="sm">
						{{ __('Read-only') }}
					</Badge>
					<Button
						v-if="displayPublished"
						variant="ghost"
						:title="__('View live')"
						:aria-label="__('View live')"
						@click="openPage"
					>
						<span class="lucide-eye size-4" aria-hidden="true" />
					</Button>
					<Button
						v-if="!readonly"
						:variant="showPageSettings ? 'subtle' : 'ghost'"
						:title="__('Page settings')"
						:aria-label="__('Page settings')"
						:aria-pressed="showPageSettings"
						@click="togglePageSettings"
					>
						<span class="lucide-panel-right size-4" aria-hidden="true" />
					</Button>
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
					<SubmitForReviewButton v-if="!readonly" />
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
			<div class="flex min-h-0 flex-1">
				<!-- The one scroller on this page: the editor body scrolls under
				     the sticky toolbar, and the bubble menu and the outline rail
				     both measure against it. -->
				<ScrollArea class="min-h-0 flex-1" viewport-class="pb-10">
					<WikiEditor v-if="editorKey" :key="editorKey" :content="editorContent" :document-key="wikiDoc.doc?.doc_key" :saved-content="savedContent" :readonly="readonly" :show-outline="!showPageSettings" @save="saveContent" @save-all="flushOtherDirtyPages" @content-change="onEditorContentChange" @content-ready="onEditorContentReady">
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
							</div>
						</template>
					</WikiEditor>
					<!-- Editor body skeleton while the CR page overlay loads -->
					<div v-else class="mx-auto w-full max-w-[770px] space-y-4 px-6 pt-8">
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
				<PageSettingsPanel
					v-if="showPageSettings && !readonly"
					:doc-resource="wikiDoc"
					:doc-key="wikiDoc.doc?.doc_key"
					:title="displayTitle"
					:slug="displaySlug"
					:route="displayRoute"
					:published="displayPublished"
					:content="editorContent"
					@close="closePageSettings"
					@node-updated="loadCrPage"
				/>
			</div>
		</div>

		<!-- Content skeleton -->
		<div v-else class="h-full flex flex-col">
			<div class="flex min-h-12 shrink-0 items-center gap-2 border-b border-outline-gray-2 px-3 sm:px-5">
				<Skeleton class="h-4 w-40 rounded-4" />
				<div class="ml-auto flex shrink-0 items-center gap-2">
					<Skeleton class="h-8 w-24 rounded-4" />
					<Skeleton class="h-8 w-16 rounded-4" />
					<Skeleton class="size-8 rounded-4" />
				</div>
			</div>
			<div class="mx-auto w-full max-w-[770px] flex-1 px-6 pb-6 pt-8 space-y-4">
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
import { usePageSettingsPanel } from '@/composables/usePageSettingsPanel';
import { buildGithubEditUrl } from '@/lib/github';
import { SPACE_TREE_KEY, crumbRoute, trailToNode } from '@/lib/spaceTree';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useUserStore } from '@/stores/user';
import {
	Badge,
	Breadcrumbs,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	ScrollArea,
	Skeleton,
	createDocumentResource,
	getCachedDocumentResource,
	toast,
	usePageMeta,
} from 'frappe-ui';
import { computed, inject, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageSettingsPanel from './PageSettingsPanel.vue';
import SubmitForReviewButton from './SubmitForReviewButton.vue';
import WikiEditor from './WikiEditor.vue';

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

const editableTitle = ref('');
const showRenameDialog = ref(false);
const editableRenameTitle = ref('');
const isRenaming = ref(false);
const showDeleteDialog = ref(false);
const isDeleting = ref(false);

const router = useRouter();
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

// The panel is module-scoped state: it stays open across page switches, and
// the toggle that owns it lives in this header.
const {
	isOpen: showPageSettings,
	close: closePageSettings,
	toggle: togglePageSettings,
} = usePageSettingsPanel();

// Slug has no draft buffer — nothing but the settings panel edits it — so the
// CR overlay is the newest copy until the request merges.
const displaySlug = computed(
	() => currentCrPage.value?.slug || wikiDoc.value.doc?.slug || '',
);

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
	const options = [];
	// A synced page has no editable state here — the repo owns it, and the
	// header already offers the trip to GitHub.
	if (!props.readonly) {
		options.push(
			{
				label: __('Rename'),
				icon: 'lucide-pencil',
				onClick: openRenameDialog,
			},
			{
				label: displayPublished.value ? __('Unpublish') : __('Publish'),
				icon: 'lucide-upload-cloud',
				onClick: togglePublish,
			},
		);
	}
	if (userStore.isWikiManager && wikiDoc.value.doc?.name) {
		options.push({
			label: __('View in Desk'),
			icon: 'lucide-external-link',
			onClick: () =>
				window.open(
					`/app/wiki-document/${encodeURIComponent(wikiDoc.value.doc.name)}`,
					'_blank',
				),
		});
	}
	if (!props.readonly) {
		options.push({
			label: __('Delete'),
			icon: 'lucide-trash-2',
			onClick: () => {
				showDeleteDialog.value = true;
			},
		});
	}
	return options;
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
		await loadCrPage();
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
