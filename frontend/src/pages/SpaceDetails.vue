<template>
    <div class="flex flex-col h-full">
        <!-- Mobile: contextual header in the shell's PageHeaderTarget
             (tree toggle on the left, centered space name). -->
        <PageHeaderMobile
            v-if="isMobile"
            :title="spaceStore.doc?.space_name || spaceId"
        >
            <template #prefix>
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

        <!-- Desktop renders the mode strip in the space sidebar, which is where
             the space lives now. Mobile has no sidebar, and the strip's actions
             (submit, discard, merge, sync) must not hide behind the tree drawer,
             so there it stays inline above the content. -->
        <SpaceModeStrip v-if="isMobile" />

        <div
            v-if="spaceStore.tabsEnabled && spaceStore.tabs.length"
            class="h-12 shrink-0 flex items-stretch border-b border-outline-gray-2 px-2"
        >
            <WikiTabBar
                :tabs="spaceStore.tabs"
                :active-key="spaceStore.activeTabKey"
                :can-manage-tabs="spaceStore.canManageTabs && !spaceStore.isGitSynced"
                @select="spaceStore.selectTab"
                @create="openCreateTabDialog"
                @reorder="reorderTab"
                @update-icon="updateTabIcon"
                @rename-tab="renameTab"
            />
        </div>

        <div class="flex flex-1 min-h-0">
            <!-- The tree lives in the app sidebar on desktop; on mobile there is
                 no sidebar, so it rides in an off-canvas drawer instead. -->
            <MobileDrawer
                v-if="isMobile"
                :open="mobileTreeOpen"
                side="left"
                :title="__('Pages')"
                @update:open="mobileTreeOpen = $event"
            >
                <SpaceTreePanel
                    :space-id="spaceId"
                    :space-name="spaceStore.doc?.space_name"
                    :space-route="spaceStore.doc?.route"
                    :space-loaded="spaceStore.isLoaded"
                    :tree-data="spaceStore.visibleTreeData"
                    :space-root-node="spaceStore.treeData?.root_group || ''"
                    :change-type-map="spaceStore.changeTypeMap"
                    :readonly="spaceStore.isGitSynced"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    :can-manage-tabs="spaceStore.canManageTabs"
                    @refresh="spaceStore.refreshTree"
                    @reorder-state-change="spaceStore.setTreeReordering"
                    @open-settings="openSettings"
                />
            </MobileDrawer>

            <main class="flex-1 flex flex-col bg-surface-base min-w-0">
                <div class="flex-1 overflow-auto">
                    <router-view
                        :space-id="spaceId"
                        :readonly="spaceStore.isGitSynced"
                        @refresh="spaceStore.refreshTree"
                    />
                </div>
            </main>
        </div>

        <SpaceSettings
            v-model="showSpaceSettings"
            :space="spaceStore.space"
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
                        :modelValue="spaceStore.doc?.route"
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
import {
	Button,
	Dialog,
	FormControl,
	PageHeaderMobile,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MobileDrawer from '../components/MobileDrawer.vue';
import SpaceModeStrip from '../components/SpaceModeStrip.vue';
import SpaceSettings from '../components/SpaceSettings/SpaceSettings.vue';
import SpaceTreePanel from '../components/SpaceTreePanel.vue';
import WikiTabBar from '../components/WikiTabBar.vue';
import { useMobile } from '../composables/useMobile';
import { useSpaceSettings } from '../composables/useSpaceSettings';
import { GENERAL_KEY } from '../lib/spaceTabs.js';
import { SPACE_TREE_KEY, firstPageIn } from '../lib/spaceTree.js';
import { DEFAULT_TAB_ICON } from '../lib/tabIcons.js';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';

const props = defineProps({
	spaceId: {
		type: String,
		required: true,
	},
});

const route = useRoute();

const router = useRouter();
const draftStore = useDraftWorkspaceStore();
const spaceStore = useSpaceStore();
const { showSpaceSettings, open: openSpaceSettings } = useSpaceSettings();

// Expose the draft workspace store for E2E tests (mirrors window.wikiEditor).
// Lets specs invoke optimistic actions like moveNode without driving fragile
// drag-and-drop sequences.
onMounted(() => {
	window.__draftStore = draftStore;
});
onBeforeUnmount(() => {
	delete window.__draftStore;
});

const showUpdateRoutesDialog = ref(false);
const showCloneSpaceDialog = ref(false);
const newRoute = ref('');
const updatingRoutes = ref(false);
const cloneRoute = ref('');
const cloningSpace = ref(false);

const currentPageId = computed(() => route.params.pageId || null);
const currentDraftKey = computed(() => route.params.docKey || null);

const { isMobile } = useMobile();
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
	openSpaceSettings();
}

// The open page's panel is a child route, so it can't take the tree as a prop
// without every sibling route taking it too.
provide(
	SPACE_TREE_KEY,
	computed(() => spaceStore.treeData),
);

function openUpdateRoutesDialog() {
	newRoute.value = spaceStore.doc?.route || '';
	showUpdateRoutesDialog.value = true;
}

function openCloneSpaceDialog() {
	if (spaceStore.doc?.route) {
		cloneRoute.value = `${spaceStore.doc.route}-copy`;
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
		await spaceStore.space.updateRoutes.submit({
			new_route: newRoute.value.trim(),
		});
		close();
		await spaceStore.space.reload();
		await spaceStore.refreshTree();
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
		await spaceStore.space.cloneWikiSpace.submit({
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
			parentKey: spaceStore.treeData?.root_group || null,
			title,
			isGroup: true,
			isTab: true,
			tabIcon: DEFAULT_TAB_ICON,
		});
		const newKey = await promise;
		if (newKey) spaceStore.selectTab(newKey);
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
	const remaining = (spaceStore.treeData?.children || []).filter(
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
		newParentKey: spaceStore.treeData?.root_group || null,
		newIndex,
	});
}

// The Home tab is synthetic — its icon/title live on the Wiki Space, not a
// node — so it updates the space doc directly; real tabs go through the draft.
async function updateTabIcon({ key, icon }) {
	try {
		if (key === GENERAL_KEY) {
			await spaceStore.space.setValue.submit({ home_tab_icon: icon });
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
			await spaceStore.space.setValue.submit({ home_tab_title: title });
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
// rather than push so the back button returns to the library, not here.
// `autoOpening` guards the async gap before route.name flips to 'SpacePage':
// without it, a treeData update mid-navigation (e.g. a git-synced background
// sync) could fire a second replace and override the in-flight one.
let autoOpening = false;
function autoOpenPage() {
	if (autoOpening || route.name !== 'SpaceDetails') return;
	const tree = spaceStore.treeData;
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
watch([() => spaceStore.treeData, () => route.name], autoOpenPage, {
	immediate: true,
});
</script>
