<template>
    <div class="flex flex-col h-full">
        <!-- Mobile: contextual header in the shell's PageHeaderTarget
             (tree toggle on the left, centered space name). -->
        <PageHeaderMobile
            v-if="isMobile"
            :title="space.doc?.space_name || spaceId"
        >
            <template #left>
                <Button
                    variant="ghost"
                    :label="__('Pages')"
                    @click="mobileTreeOpen = true"
                >
                    <template #icon>
                        <span class="lucide-panel-left size-4" aria-hidden="true" />
                    </template>
                </Button>
            </template>
        </PageHeaderMobile>

        <!-- Full-width chrome above the sidebar+content row, mirroring the
             reader's navbar > tabs > tree stack. The draft/git banner is about
             the whole draft, so it outranks the tab bar, which in turn sits
             above the tree. -->
        <SpaceChromeBar
            v-if="isGitSynced"
            :space-name="space.doc?.space_name || spaceId"
            :space-route="space.doc?.route"
            @open-settings="openSettings"
        >
            <template #badge>
                <Badge variant="subtle" theme="gray" size="sm" :title="__('Synced from GitHub')">
                    {{ syncStatusLabel(space.doc?.last_sync_status) }}
                </Badge>
            </template>
            <template #meta>
                <a
                    v-if="space.doc?.repo_full_name"
                    :href="`https://github.com/${space.doc.repo_full_name}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex min-w-0 items-center gap-1 text-xs text-ink-gray-5 hover:text-ink-gray-7"
                    :title="__('Synced from GitHub')"
                >
                    <span class="lucide-github size-3.5 shrink-0" aria-hidden="true" />
                    <span class="truncate">{{ space.doc.repo_full_name }}<span v-if="space.doc?.branch">@{{ space.doc.branch }}</span></span>
                </a>
            </template>
            <template #actions>
                <Button variant="outline" size="sm" :loading="syncing" @click="() => syncNow()">
                    <template #prefix>
                        <span class="lucide-refresh-cw size-4" aria-hidden="true" />
                    </template>
                    {{ __('Sync now') }}
                </Button>
            </template>
        </SpaceChromeBar>
        <ContributionBanner
            v-else
            :mergeDisabled="isTreeReordering"
            :space-name="space.doc?.space_name || spaceId"
            :space-route="space.doc?.route"
            @submit="handleSubmitChangeRequest"
            @withdraw="handleArchiveChangeRequest"
            @merge="handleMergeChangeRequest"
            @open-settings="openSettings"
        />

        <div
            v-if="tabsEnabled && tabs.length"
            class="h-12 shrink-0 flex items-stretch border-b border-outline-gray-2 px-2"
        >
            <WikiTabBar
                :tabs="tabs"
                :active-key="activeTabKey"
                :can-manage-tabs="canManageTabs && !isGitSynced"
                @select="selectTab"
                @create="openCreateTabDialog"
                @reorder="reorderTab"
                @update-icon="updateTabIcon"
                @rename-tab="renameTab"
            />
        </div>

        <!-- Sidebar + content share the row beneath the chrome. -->
        <div class="flex flex-1 min-h-0">
            <!-- Desktop: inline resizable tree -->
            <aside
                v-if="!isMobile"
                ref="sidebarRef"
                class="border-r border-outline-gray-2 flex flex-col relative flex-shrink-0"
                :style="{ width: `${sidebarWidth}px` }"
            >
                <SpaceTreePanel
                    :space-id="spaceId"
                    :space-name="space.doc?.space_name"
                    :space-route="space.doc?.route"
                    :space-loaded="!!space.doc"
                    :tree-data="visibleTreeData"
                    :space-root-node="treeData?.root_group || ''"
                    :change-type-map="changeTypeMap"
                    :readonly="isGitSynced"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    :can-manage-tabs="canManageTabs"
                    :compact-header="treeHeaderCompact"
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
                    :tree-data="visibleTreeData"
                    :space-root-node="treeData?.root_group || ''"
                    :change-type-map="changeTypeMap"
                    :readonly="isGitSynced"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    :can-manage-tabs="canManageTabs"
                    :compact-header="treeHeaderCompact"
                    @refresh="refreshTree"
                    @reorder-state-change="handleReorderStateChange"
                    @open-settings="openSettings"
                />
            </MobileDrawer>

            <main class="flex-1 flex flex-col bg-surface-base min-w-0">
                <div class="flex-1 overflow-auto">
                    <router-view
                        :space-id="spaceId"
                        :readonly="isGitSynced"
                        @refresh="refreshTree"
                    />
                </div>
            </main>
        </div>

        <SpaceSettings
            v-model="showSettingsDialog"
            :space="space"
            :space-id="spaceId"
            @open-update-routes="openUpdateRoutesDialog"
            @open-clone="openCloneSpaceDialog"
        />

        <Dialog v-model:open="showCreateTabDialog">
            <template #title>
                <h3 class="text-2xl-semibold text-ink-gray-9">
                    {{ __('Create New Tab') }}
                </h3>
            </template>
            <template #default>
                <div class="py-2">
                    <FormControl
                        type="text"
                        :label="__('Title')"
                        v-model="newTabTitle"
                        :placeholder="__('Enter tab title')"
                        @keyup.enter="createTab"
                    />
                </div>
            </template>
            <template #actions>
                <div class="flex justify-end gap-2">
                    <Button variant="outline" @click="showCreateTabDialog = false">
                        {{ __('Cancel') }}
                    </Button>
                    <Button variant="solid" :loading="creatingTab" @click="createTab">
                        {{ __('Create') }}
                    </Button>
                </div>
            </template>
        </Dialog>

        <Dialog v-model:open="showUpdateRoutesDialog">
            <template #title>
                <h3 class="text-2xl-semibold text-ink-gray-9">
                    {{ __('Update Wiki Space Routes') }}
                </h3>
            </template>
            <template #default>
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

        <Dialog v-model:open="showCloneSpaceDialog">
            <template #title>
                <h3 class="text-2xl-semibold text-ink-gray-9">
                    {{ __('Clone Wiki Space') }}
                </h3>
            </template>
            <template #default>
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
	PageHeaderMobile,
	createDocumentResource,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ContributionBanner from '../components/ContributionBanner.vue';
import MobileDrawer from '../components/MobileDrawer.vue';
import SpaceChromeBar from '../components/SpaceChromeBar.vue';
import SpaceSettings from '../components/SpaceSettings/SpaceSettings.vue';
import SpaceTreePanel from '../components/SpaceTreePanel.vue';
import WikiTabBar from '../components/WikiTabBar.vue';
import { useMobile } from '../composables/useMobile';
import { useSidebarResize } from '../composables/useSidebarResize';
import { useSpaceTabs } from '../composables/useSpaceTabs.js';
import { GENERAL_KEY } from '../lib/spaceTabs.js';
import { SPACE_TREE_KEY, firstPageIn } from '../lib/spaceTree.js';
import { DEFAULT_TAB_ICON } from '../lib/tabIcons.js';
import { useSocket } from '../socket';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { toPublished } from '../stores/draftWorkspace/utils';

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
});
onBeforeUnmount(() => {
	delete window.__draftStore;
	syncPollCancelled = true;
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

const { isMobile } = useMobile();
const mobileTreeOpen = ref(false);

// Both the CR banner and the git-sync banner carry the space name +
// back/settings on desktop, so the tree header drops its own identity block to
// avoid showing it twice. On mobile the banner is a separate compact header and
// the tree lives in a drawer, so the drawer keeps its full header (incl.
// Settings). The plain (non-CR, non-git) space has no banner, so it isn't
// compacted — its identity lives only in the tree header.
const treeHeaderCompact = computed(
	() => !isMobile.value && (crStore.isChangeRequestMode || isGitSynced.value),
);

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

// Tabs are opt-in per space (Wiki Space.enable_tabs). Off, the bar is gone and
// the sidebar shows the whole tree — tab flags on nodes are kept, just ignored.
const tabsEnabled = computed(() => Boolean(space.doc?.enable_tabs));

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

// Tab management is editor-only (mirrors the backend's can_manage_tabs, which
// is can_write_space). Enforcement stays server-side; this only hides the UI.
const canWriteSpace = ref(false);
const capabilitiesResource = createResource({
	url: 'wiki.api.get_space_capabilities',
	onSuccess: (data) => {
		canWriteSpace.value = Boolean(data?.can_write);
	},
});

watch(
	() => props.spaceId,
	(id) => {
		if (id) capabilitiesResource.submit({ space: id });
	},
	{ immediate: true },
);

// Managing tabs needs both the permission and a space that uses tabs at all.
const canManageTabs = computed(() => canWriteSpace.value && tabsEnabled.value);

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
		is_tab: !!node.is_tab,
		tab_icon: node.tab_icon || null,
		is_published: toPublished(node.is_published),
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

// The open page's panel is a child route, so it can't take the tree as a prop
// without every sibling route taking it too.
provide(SPACE_TREE_KEY, treeData);

// Tab state lives here rather than in SpaceTreePanel: the bar renders in this
// column's header while the tree it filters renders in the sidebar, so a single
// owner keeps the two from disagreeing.
const homeMeta = computed(() => ({
	title: space.doc?.home_tab_title || '',
	icon: space.doc?.home_tab_icon || '',
}));

const { tabs, activeTabKey, selectTab, visibleTreeData } = useSpaceTabs(
	treeData,
	currentPageId,
	currentDraftKey,
	homeMeta,
	tabsEnabled,
);

// Creating and reordering tabs is owned here alongside the bar, rather than in
// the tree's own dialogs: a tab is always parented to the space root, so it
// doesn't depend on which subtree the sidebar is currently showing.
const showCreateTabDialog = ref(false);
const newTabTitle = ref('');
const creatingTab = ref(false);

function openCreateTabDialog() {
	newTabTitle.value = '';
	showCreateTabDialog.value = true;
}

async function createTab() {
	const title = newTabTitle.value.trim();
	if (!title) {
		toast.warning(__('Tab name is required'));
		return;
	}
	showCreateTabDialog.value = false;
	creatingTab.value = true;
	try {
		const { promise } = draftStore.createNode({
			parentKey: treeData.value?.root_group || null,
			title,
			isGroup: true,
			isTab: true,
			tabIcon: DEFAULT_TAB_ICON,
		});
		const newKey = await promise;
		if (newKey) selectTab(newKey);
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error creating tab'));
	} finally {
		creatingTab.value = false;
	}
}

// Drag-reorder from the bar. Tabs and non-tab top-level content share one
// sibling list, so the drop index is translated back into that list's
// coordinates — dropping a tab past the last one must not jump it over the
// untabbed content that follows.
function reorderTab({ docKey, toIndex }) {
	// moveNode splices into the list *after* pulling the dragged node out, so
	// index maths has to happen against the same post-removal list.
	const remaining = (treeData.value?.children || []).filter(
		(node) => node.doc_key !== docKey,
	);
	const remainingTabs = remaining.filter((node) => node.is_tab);

	const anchor = remainingTabs[toIndex];
	const newIndex = anchor
		? remaining.indexOf(anchor)
		: // Dropped past the last tab — land just after it, never after the
			// untabbed top-level content that follows.
			remaining.indexOf(remainingTabs[remainingTabs.length - 1]) + 1;

	draftStore.moveNode({
		docKey,
		newParentKey: treeData.value?.root_group || null,
		newIndex,
	});
}

// The Home tab is synthetic — its icon/title live on the Wiki Space, not a
// node — so it updates the space doc directly; real tabs go through the draft.
async function updateTabIcon({ key, icon }) {
	try {
		if (key === GENERAL_KEY) {
			await space.setValue.submit({ home_tab_icon: icon });
		} else {
			await draftStore.updateNode(key, { tab_icon: icon });
		}
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating tab icon'));
	}
}

async function renameTab({ key, title }) {
	try {
		if (key === GENERAL_KEY) {
			await space.setValue.submit({ home_tab_title: title });
		} else {
			await draftStore.updateNode(key, { title });
		}
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error renaming tab'));
	}
}

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
			: null) || firstPageIn(tree.children);

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
	crStore.finalizing = 'withdrawing';
	try {
		await crStore.archiveChangeRequest();
		toast.success(__('Change request archived'));
		crStore.currentChangeRequest = null;
		crStore.clearChanges();
		// Drop the local-first drafts too, or hydrate restores the discarded
		// content from IndexedDB (and autosave re-creates the change request).
		await draftStore.discardPersistedDraftsForCr(crName);
		// Same as merge: the published tree the next CR opens on is the one
		// already rendered, so it stays put while hydrate refreshes it.
		draftStore.reset({ keepTree: true });
		await draftStore.hydrate(props.spaceId);
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error archiving change request'));
	} finally {
		crStore.finalizing = null;
	}
}

function findNodeByDocKey(nodes, docKey) {
	if (!nodes) return null;
	for (const node of nodes) {
		if (node.doc_key === docKey) return node;
		const found = findNodeByDocKey(node.children, docKey);
		if (found) return found;
	}
	return null;
}

async function handleMergeChangeRequest() {
	if (isTreeReordering.value) {
		toast.error(__('Please wait for reordering to finish before merging'));
		return;
	}
	const blockerMessage = finalizationError(__('merging'));
	if (blockerMessage) {
		toast.error(blockerMessage);
		return;
	}
	const docKey = currentDraftKey.value;
	const changeRequestName = crStore.currentChangeRequest?.name;
	// Held across the rehydrate as well as the merge itself, so the banner shows
	// one state for the whole trip instead of the CR's intermediate ones.
	crStore.finalizing = 'merging';
	try {
		await crStore.approveAndMergeChangeRequest();
		toast.success(__('Change request merged'));
		crStore.currentChangeRequest = null;
		crStore.clearChanges();
		// The CR's drafts are now merged into the published doc — clear them so a
		// stale local copy can't resurrect after the merge.
		await draftStore.discardPersistedDraftsForCr(changeRequestName);
		// Keep the tree on screen: the merged tree is all but identical to the one
		// already rendered, so blanking it to a skeleton for a round trip is pure
		// loss. hydrate() swaps in the new one in a single paint.
		draftStore.reset({ keepTree: true });

		// Leave the draft route before the rehydrate, not after: the draft the
		// URL points at no longer exists, so waiting would park the editor on
		// "Draft not found" for the length of the round trip. The tree is still
		// on screen (keepTree), so the published page is resolvable now — except
		// for a page created in this CR, which only gets a document_name once
		// the merge lands, so that one is resolved again afterwards.
		const openMergedPage = () => {
			if (!docKey) return true;
			const node = findNodeByDocKey(treeData.value?.children, docKey);
			if (!node?.document_name) return false;
			router.push({
				name: 'SpacePage',
				params: { spaceId: props.spaceId, pageId: node.document_name },
			});
			return true;
		};

		const opened = openMergedPage();
		await draftStore.hydrate(props.spaceId);
		if (!opened) openMergedPage();
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
	} finally {
		crStore.finalizing = null;
	}
}
</script>
