<template>
    <div class="flex h-full">
        <!-- Desktop: inline resizable tree -->
        <aside
            v-if="!isMobile"
            ref="sidebarRef"
            class="border-r border-outline-gray-2 flex flex-col bg-surface-gray-1 relative flex-shrink-0"
            :style="{ width: `${sidebarWidth}px` }"
        >
            <SpaceTreePanel
                :space-id="spaceId"
                :space-name="space.doc?.space_name"
                :space-route="space.doc?.route"
                :space-loaded="!!space.doc"
                :tree-data="treeData"
                :change-type-map="changeTypeMap"
                :readonly="isGitSynced"
                :selected-page-id="currentPageId"
                :selected-draft-key="currentDraftKey"
                @refresh="refreshTree"
                @reorder-state-change="handleReorderStateChange"
                @open-settings="openSettings"
            />
            <div
                class="absolute top-0 right-0 w-1 h-full cursor-col-resize"
                :class="sidebarResizing ? 'bg-surface-gray-4' : 'hover:bg-surface-gray-4'"
                @mousedown="startResize"
            />
        </aside>

        <!-- Mobile: same tree in an off-canvas drawer -->
        <MobileDrawer
            v-else
            :open="mobileTreeOpen"
            side="left"
            :title="__('Pages')"
            @update:open="mobileTreeOpen = $event"
        >
            <SpaceTreePanel
                :space-id="spaceId"
                :space-name="space.doc?.space_name"
                :space-route="space.doc?.route"
                :space-loaded="!!space.doc"
                :tree-data="treeData"
                :change-type-map="changeTypeMap"
                :readonly="isGitSynced"
                :selected-page-id="currentPageId"
                :selected-draft-key="currentDraftKey"
                @refresh="refreshTree"
                @reorder-state-change="handleReorderStateChange"
                @open-settings="openSettings"
            />
        </MobileDrawer>

        <!-- Mobile: contextual header in the top nav (tree toggle + space name).
             The toggle matches the nav's logo/menu buttons (44px). -->
        <Teleport v-if="isMobile" to="#app-header">
            <button
                class="flex size-11 shrink-0 items-center justify-center rounded text-ink-gray-7 hover:bg-surface-gray-3"
                :title="__('Pages')"
                @click="mobileTreeOpen = true"
            >
                <LucidePanelLeft class="size-5" />
            </button>
            <span class="truncate text-base font-semibold text-ink-gray-9">
                {{ space.doc?.space_name || spaceId }}
            </span>
        </Teleport>

        <main class="flex-1 flex flex-col bg-surface-white min-w-0">
            <div
                v-if="isGitSynced"
                class="px-4 py-3 flex items-center justify-between gap-4 bg-surface-gray-1 border-b border-outline-gray-2"
            >
                <div class="flex items-center gap-3 min-w-0">
                    <LucideGithub class="size-5 shrink-0 text-ink-gray-7" />
                    <div class="min-w-0">
                        <a
                            v-if="space.doc?.repo_full_name"
                            :href="`https://github.com/${space.doc.repo_full_name}`"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-sm font-medium text-ink-gray-8 hover:text-ink-gray-9 truncate block"
                        >
                            {{ space.doc.repo_full_name }}<span v-if="space.doc?.branch">@{{ space.doc.branch }}</span>
                        </a>
                        <p v-else class="text-sm font-medium text-ink-gray-8 truncate">
                            {{ space.doc?.space_name || spaceId }}
                        </p>
                        <div class="flex items-center gap-2 mt-0.5">
                            <p class="text-xs text-ink-gray-5">{{ __('Synced from GitHub') }}</p>
                            <Badge variant="subtle" theme="gray" size="sm">
                                {{ syncStatusLabel(space.doc?.last_sync_status) }}
                            </Badge>
                        </div>
                    </div>
                </div>
                <Button variant="outline" size="sm" :loading="syncing" @click="() => syncNow()">
                    <template #prefix>
                        <LucideRefreshCw class="size-4" />
                    </template>
                    {{ __('Sync now') }}
                </Button>
            </div>
            <ContributionBanner
                v-else
                :mergeDisabled="isTreeReordering"
                @submit="handleSubmitChangeRequest"
                @withdraw="handleArchiveChangeRequest"
                @merge="handleMergeChangeRequest"
            />
            <div class="flex-1 overflow-auto">
                <router-view
                    :space-id="spaceId"
                    :readonly="isGitSynced"
                    @refresh="refreshTree"
                    @publish="handleMergeChangeRequest"
                />
            </div>
        </main>

        <Dialog v-model="showSettingsDialog" :options="{ size: '4xl' }">
            <template #body>
                <SpaceSettings
                    :space="space"
                    :space-id="spaceId"
                    @close="showSettingsDialog = false"
                    @open-update-routes="openUpdateRoutesDialog"
                    @open-clone="openCloneSpaceDialog"
                />
            </template>
        </Dialog>

        <Dialog v-model="showUpdateRoutesDialog">
            <template #body-title>
                <h3 class="text-xl font-semibold text-ink-gray-9">
                    {{ __('Update Wiki Space Routes') }}
                </h3>
            </template>
            <template #body-content>
                <div class="space-y-4 py-2">
                    <FormControl
                        type="text"
                        :label="__('Current Base Route')"
                        :modelValue="space.doc?.route"
                        :disabled="true"
                    />
                    <FormControl
                        type="text"
                        :label="__('New Base Route')"
                        v-model="newRoute"
                        :placeholder="__('Enter new route (without leading slash)')"
                    />
                </div>
            </template>
            <template #actions="{ close }">
                <div class="flex justify-end gap-2">
                    <Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
                    <Button
                        variant="solid"
                        :loading="updatingRoutes"
                        @click="updateRoutes(close)"
                    >
                        {{ __('Update Routes') }}
                    </Button>
                </div>
            </template>
        </Dialog>

        <Dialog v-model="showCloneSpaceDialog">
            <template #body-title>
                <h3 class="text-xl font-semibold text-ink-gray-9">
                    {{ __('Clone Wiki Space') }}
                </h3>
            </template>
            <template #body-content>
                <div class="space-y-4 py-2">
                    <FormControl
                        type="text"
                        :label="__('New Space Route')"
                        v-model="cloneRoute"
                        :placeholder="__('Enter new route (without leading slash)')"
                    />
                </div>
            </template>
            <template #actions="{ close }">
                <div class="flex justify-end gap-2">
                    <Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
                    <Button
                        variant="solid"
                        :loading="cloningSpace"
                        @click="cloneSpace(close)"
                    >
                        {{ __('Start Cloning') }}
                    </Button>
                </div>
            </template>
        </Dialog>
    </div>
</template>

<script setup>
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useUserStore } from '@/stores/user';
import {
	Badge,
	Button,
	Dialog,
	FormControl,
	createDocumentResource,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LucideGithub from '~icons/lucide/github';
import LucidePanelLeft from '~icons/lucide/panel-left';
import LucideRefreshCw from '~icons/lucide/refresh-cw';
import ContributionBanner from '../components/ContributionBanner.vue';
import MobileDrawer from '../components/MobileDrawer.vue';
import SpaceSettings from '../components/SpaceSettings/SpaceSettings.vue';
import SpaceTreePanel from '../components/SpaceTreePanel.vue';
import { useMobile } from '../composables/useMobile';
import { useSidebarResize } from '../composables/useSidebarResize';
import { useSocket } from '../socket';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';

const props = defineProps({
	spaceId: {
		type: String,
		required: true,
	},
});

const route = useRoute();

const router = useRouter();
const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();
const userStore = useUserStore();

// Expose the draft workspace store for E2E tests (mirrors window.wikiEditor).
// Lets specs invoke optimistic actions like moveNode without driving fragile
// drag-and-drop sequences.
onMounted(() => {
	window.__draftStore = draftStore;
	// This page supplies the leading control (tree toggle) in the mobile top
	// nav, so the nav hides its logo while we're here.
	mobileHasLeadingControl.value = true;
});
onBeforeUnmount(() => {
	delete window.__draftStore;
	syncPollCancelled = true;
	mobileHasLeadingControl.value = false;
});

const isManager = computed(() => userStore.isWikiManager);

const showSettingsDialog = ref(false);
const showUpdateRoutesDialog = ref(false);
const showCloneSpaceDialog = ref(false);
const newRoute = ref('');
const updatingRoutes = ref(false);
const cloneRoute = ref('');
const cloningSpace = ref(false);

const sidebarRef = ref(null);
const { sidebarWidth, sidebarResizing, startResize } =
	useSidebarResize(sidebarRef);
const isTreeReordering = ref(false);

const currentPageId = computed(() => route.params.pageId || null);
const currentDraftKey = computed(() => route.params.docKey || null);

const { isMobile, mobileHasLeadingControl } = useMobile();
const mobileTreeOpen = ref(false);

// Close the tree drawer once a page is opened from it, and whenever we leave the
// mobile breakpoint, so it can't get stuck open behind the desktop layout.
watch([currentPageId, currentDraftKey, isMobile], () => {
	mobileTreeOpen.value = false;
});

// Settings opens from inside the tree drawer; close the drawer first so the
// settings dialog isn't stacked behind it (and the drawer's backdrop can't
// swallow the dialog's outside-click).
function openSettings() {
	mobileTreeOpen.value = false;
	showSettingsDialog.value = true;
}

const space = createDocumentResource({
	doctype: 'Wiki Space',
	name: props.spaceId,
	auto: true,
	whitelistedMethods: {
		updateRoutes: 'update_routes',
		cloneWikiSpace: 'clone_wiki_space_in_background',
		syncNow: 'sync_now',
	},
});

// Git-synced spaces are read-only: the repo owns the content, so there is no
// change request and no editing. We source the sidebar tree from the published
// live tree instead of a CR.
const isGitSynced = computed(() => Boolean(space.doc?.git_synced));

// "Pending"/"Running" are transient internal states; show one friendly label.
function syncStatusLabel(status) {
	return (
		{ Pending: __('Sync in progress'), Running: __('Sync in progress') }[
			status
		] ||
		status ||
		__('Sync in progress')
	);
}

const readonlyTreeResource = createResource({
	url: 'wiki.api.wiki_space.get_wiki_tree',
});

// The space the loaded readonly tree belongs to. This component is reused across
// spaces (the router keeps one SpaceDetails for /spaces/:spaceId), so the
// resource holds the previous space's tree until the new one loads — track the
// owner so `treeData` can reject a stale cross-space tree.
const readonlyTreeSpaceId = ref(null);

// Adapt get_wiki_tree's (name-keyed) shape into the snake_case shape the tree
// components consume. The Wiki Document `name` doubles as both the navigation
// target (document_name) and the row key (doc_key) here — synced trees have no
// CR overlay, so the internal doc_key is never needed.
function adaptReadonlyNode(node) {
	return {
		doc_key: node.name,
		document_name: node.name,
		title: node.title,
		route: node.route,
		is_group: !!node.is_group,
		is_published: node.is_published !== false,
		is_external_link: false,
		external_url: null,
		children: (node.children || []).map(adaptReadonlyNode),
	};
}

const readonlyTreeData = computed(() => {
	const data = readonlyTreeResource.data;
	if (!data) return null;
	return {
		root_group: data.root_group || '',
		children: (data.children || []).map(adaptReadonlyNode),
	};
});

const syncing = ref(false);
// Guards the auto first-sync so the watch can't enqueue it (and toast) twice
// while space.doc re-renders before last_sync_status lands.
const firstSyncKicked = ref(false);
async function loadReadonlyTree() {
	const target = props.spaceId;
	await readonlyTreeResource.submit({ space_id: target });
	readonlyTreeSpaceId.value = target;
}

// Cancels an in-flight poll when the user navigates away mid-sync.
let syncPollCancelled = false;

// The sync runs on the long queue, so poll the doc until it reports a terminal
// status — refreshing the tree each tick so pages (and the in-progress state)
// update as soon as the sync lands, however long it takes.
async function pollSyncUntilDone({ tries = 30, interval = 2000 } = {}) {
	for (let i = 0; i < tries && !syncPollCancelled; i++) {
		await new Promise((resolve) => setTimeout(resolve, interval));
		if (syncPollCancelled) return;
		await Promise.all([space.reload(), loadReadonlyTree()]);
		const status = space.doc?.last_sync_status;
		if (status === 'Success' || status === 'Error') return;
	}
}

async function syncNow({ silent = false } = {}) {
	syncing.value = true;
	syncPollCancelled = false;
	try {
		await space.syncNow.submit();
		if (!silent)
			toast.success(__('Sync started — pulling the latest from GitHub'));
		// Realtime (below) normally resolves this first; the poll is the fallback
		// for when the socket isn't connected.
		await pollSyncUntilDone();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Could not start sync'));
	} finally {
		syncing.value = false;
	}
}

// Live sync updates from the background job (broadcast site-wide by
// wiki.wiki.git_sync._publish_sync_status) — reflect progress instantly and
// refresh the tree on completion, without waiting on the poll fallback. Also
// covers webhook-triggered syncs, which never go through syncNow() here.
function onSyncRealtime(data) {
	if (!data || data.space !== props.spaceId) return;
	if (space.doc) space.doc.last_sync_status = data.status;
	if (data.status === 'Success' || data.status === 'Error') {
		syncPollCancelled = true;
		syncing.value = false;
		Promise.all([space.reload(), loadReadonlyTree()]);
	}
}

onMounted(() => {
	useSocket()?.on('wiki_git_sync_update', onSyncRealtime);
});
onBeforeUnmount(() => {
	useSocket()?.off('wiki_git_sync_update', onSyncRealtime);
});

function openUpdateRoutesDialog() {
	newRoute.value = space.doc?.route || '';
	showUpdateRoutesDialog.value = true;
}

function openCloneSpaceDialog() {
	if (space.doc?.route) {
		cloneRoute.value = `${space.doc.route}-copy`;
	} else {
		cloneRoute.value = '';
	}
	showCloneSpaceDialog.value = true;
}

async function updateRoutes(close) {
	if (!newRoute.value?.trim()) {
		return;
	}

	updatingRoutes.value = true;
	try {
		await space.updateRoutes.submit({ new_route: newRoute.value.trim() });
		close();
		await space.reload();
		await refreshTree();
	} catch (error) {
		console.error('Failed to update routes:', error);
	} finally {
		updatingRoutes.value = false;
	}
}

async function cloneSpace(close) {
	if (!cloneRoute.value?.trim()) {
		return;
	}

	cloningSpace.value = true;
	try {
		await space.cloneWikiSpace.submit({
			new_space_route: cloneRoute.value.trim(),
		});
		toast.success(__('Cloning started in background'));
		close();
	} catch (error) {
		console.error('Failed to start clone:', error);
		toast.error(error.messages?.[0] || __('Error starting clone'));
	} finally {
		cloningSpace.value = false;
	}
}

// Tree, page drafts, and pending mutations live in the draft workspace store.
// We hydrate it on space load and after merge/archive transitions; routine
// edits update the store optimistically without a server round-trip.
// `treeAsLegacy` is an empty-but-truthy object before hydration, so gate on
// `hasLoadedTree` — otherwise the sidebar flashes "No pages yet" instead of
// the loading skeleton while the tree is being fetched.
const treeData = computed(() => {
	// Both sources outlive a space switch: the readonly resource keeps the old
	// space's tree until the new fetch lands, and draftStore is a global
	// singleton still hydrated for the previous space. Returning a stale tree
	// here makes auto-open navigate into the wrong space's page, so gate each on
	// belonging to the current space.
	if (isGitSynced.value) {
		return readonlyTreeSpaceId.value === props.spaceId
			? readonlyTreeData.value
			: null;
	}
	if (draftStore.spaceId !== props.spaceId) return null;
	return draftStore.hasLoadedTree ? draftStore.treeAsLegacy : null;
});

// Remember the last page opened in this space (per-space, like the tree's
// expanded-nodes state) so re-entering the space reopens it instead of the
// "Select a page" welcome screen. We track saved pages only (document_name);
// unsaved drafts fall back to the first page. Read/write localStorage directly
// keyed on the *live* spaceId — a reactive useStorage key can write the old
// space's value into the new space's key during a switch.
function lastPageKey() {
	return `wiki-last-page-${props.spaceId}`;
}

// `immediate` so a direct load onto a page URL (e.g. a bookmark) is remembered
// too, not only in-app navigations that change `currentPageId`.
watch(
	currentPageId,
	(pageId) => {
		if (pageId) localStorage.setItem(lastPageKey(), pageId);
	},
	{ immediate: true },
);

function findNodeByDocumentName(nodes, name) {
	if (!nodes) return null;
	for (const node of nodes) {
		if (node.document_name === name) return node;
		const found = findNodeByDocumentName(node.children, name);
		if (found) return found;
	}
	return null;
}

function getFirstPage(nodes) {
	if (!nodes) return null;
	for (const node of nodes) {
		if (!node.is_group && node.document_name) return node.document_name;
		if (node.is_group) {
			const found = getFirstPage(node.children);
			if (found) return found;
		}
	}
	return null;
}

// On the bare space route (welcome screen) open a page automatically: the
// remembered page if it still exists, otherwise the tree's first page. Replace
// rather than push so the back button returns to the spaces list, not here.
// `autoOpening` guards the async gap before route.name flips to 'SpacePage':
// without it, a treeData update mid-navigation (e.g. a git-synced background
// sync) could fire a second replace and override the in-flight one.
let autoOpening = false;
function autoOpenPage() {
	if (autoOpening || route.name !== 'SpaceDetails') return;
	const tree = treeData.value;
	if (!tree) return;

	const remembered = localStorage.getItem(lastPageKey());
	const target =
		(remembered && findNodeByDocumentName(tree.children, remembered)
			? remembered
			: null) || getFirstPage(tree.children);

	if (target) {
		autoOpening = true;
		router
			.replace({
				name: 'SpacePage',
				params: { spaceId: props.spaceId, pageId: target },
			})
			.finally(() => {
				autoOpening = false;
			});
	}
}

// treeData hydrates asynchronously (CR hydrate or readonly fetch), so refire
// as it — and the route — settle.
watch([treeData, () => route.name], autoOpenPage, { immediate: true });

const changeTypeMap = computed(() => {
	const map = new Map();
	for (const change of crStore.changes) {
		map.set(change.doc_key, change.change_type);
	}
	return map;
});

watch(
	[() => space.doc, () => crStore.isChangeRequestMode],
	async ([doc, isMode], oldValues) => {
		if (!doc || !isMode) return;
		// Synced spaces never open a change request — they hydrate the
		// read-only tree path below instead.
		if (doc.git_synced) return;

		const [oldDoc] = oldValues || [];
		if (doc !== oldDoc) {
			crStore.currentChangeRequest = null;
			draftStore.reset();
		}

		await draftStore.hydrate(props.spaceId);
	},
	{ immediate: true },
);

// Read-only tree hydration for git-synced spaces. Loads the published live
// tree (no CR) and, for a never-synced space (e.g. just created), kicks off the
// first sync so its content appears without a manual click.
watch(
	() => space.doc,
	async (doc) => {
		if (!doc || !doc.git_synced) return;
		await loadReadonlyTree();
		// First-ever sync of a freshly-created space: kick it once, silently —
		// the "created successfully" toast already covers the action, and the
		// status badge reflects progress. The guard stops a double-enqueue.
		if (
			!firstSyncKicked.value &&
			!doc.last_sync_time &&
			!['Running', 'Pending', 'Success'].includes(doc.last_sync_status)
		) {
			firstSyncKicked.value = true;
			syncNow({ silent: true });
		}
	},
	{ immediate: true },
);

async function refreshTree() {
	if (isGitSynced.value) {
		await loadReadonlyTree();
		return;
	}
	if (!crStore.currentChangeRequest?.name) {
		return;
	}
	await draftStore.reloadTree();
	await draftStore.reloadChanges();
}

function handleReorderStateChange(isReordering) {
	isTreeReordering.value = Boolean(isReordering);
}

function finalizationError(action) {
	const blocker = draftStore.finalizationBlocker;
	if (blocker === 'conflict') {
		return __('Reload latest before {0}', [action]);
	}
	if (blocker === 'failed') {
		return __('Resolve failed changes before {0}', [action]);
	}
	if (blocker === 'pending') {
		return __('Wait for pending changes to sync before {0}', [action]);
	}
	if (blocker === 'unsaved') {
		return __('Save your changes before {0}', [action]);
	}
	return null;
}

async function handleSubmitChangeRequest() {
	const blockerMessage = finalizationError(__('submitting'));
	if (blockerMessage) {
		toast.error(blockerMessage);
		return;
	}
	try {
		const result = await crStore.submitForReview();
		toast.success(__('Change request submitted for review'));
		if (result?.name) {
			router.push({
				name: 'ChangeRequestReview',
				params: { changeRequestId: result.name },
			});
		}
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error submitting for review'));
	}
}

async function handleArchiveChangeRequest() {
	const crName = crStore.currentChangeRequest?.name;
	try {
		await crStore.archiveChangeRequest();
		toast.success(__('Change request archived'));
		crStore.currentChangeRequest = null;
		// Drop the local-first drafts too, or hydrate restores the discarded
		// content from IndexedDB (and autosave re-creates the change request).
		await draftStore.discardPersistedDraftsForCr(crName);
		draftStore.reset();
		await draftStore.hydrate(props.spaceId);
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error archiving change request'));
	}
}

async function handleMergeChangeRequest(docKeyOverride) {
	if (isTreeReordering.value) {
		toast.error(__('Please wait for reordering to finish before merging'));
		return;
	}
	const blockerMessage = finalizationError(__('merging'));
	if (blockerMessage) {
		toast.error(blockerMessage);
		return;
	}
	// A freshly-created page's URL still shows the tmp_* key until a
	// separate watcher swaps it for the real one — that swap can lose the
	// race with one-click Publish. The caller resolves the real key itself
	// (DraftContributionPanel.vue) and passes it here instead of trusting
	// the route param snapshot.
	const docKey = docKeyOverride || currentDraftKey.value;
	const changeRequestName = crStore.currentChangeRequest?.name;
	try {
		await crStore.approveAndMergeChangeRequest();
		toast.success(__('Change request merged'));
		crStore.currentChangeRequest = null;
		// The CR's drafts are now merged into the published doc — clear them so a
		// stale local copy can't resurrect after the merge.
		await draftStore.discardPersistedDraftsForCr(changeRequestName);
		draftStore.reset();
		await draftStore.hydrate(props.spaceId);

		if (docKey) {
			// Fetched directly from the server rather than read off `treeData`:
			// the tree is a reactive projection with its own load/hydrate
			// gating, and depending on it here made the post-merge navigation
			// vulnerable to staleness. This hits the CR-page endpoint directly
			// for exactly the field we need.
			const info = await draftStore.getMergedPageInfo(docKey);
			if (info?.document_name) {
				router.push({
					name: 'SpacePage',
					params: { spaceId: props.spaceId, pageId: info.document_name },
				});
			}
		}
	} catch (error) {
		// A merge conflict leaves the CR Approved; the conflict-resolution UI
		// lives on the review page, so send the author there to resolve it.
		if (error.exc_type === 'ValidationError' && changeRequestName) {
			toast.error(
				error.messages?.[0] || __('Merge conflict — resolve it to continue'),
			);
			router.push({
				name: 'ChangeRequestReview',
				params: { changeRequestId: changeRequestName },
			});
			return;
		}
		toast.error(error.messages?.[0] || __('Error merging change request'));
	}
}
</script>
