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
                    :tree-data="spaceStore.treeData"
                    :change-type-map="spaceStore.changeTypeMap"
                    :readonly="spaceStore.isGitSynced"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    @refresh="spaceStore.refreshTree"
                    @reorder-state-change="spaceStore.setTreeReordering"
                    @open-settings="openSettings"
                />
            </MobileDrawer>

            <!-- No scroller here: the open page owns its own, so the editor
                 scrolls under its sticky toolbar instead of the whole panel
                 sliding inside a second one. -->
            <main class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
                <router-view
                    :space-id="spaceId"
                    :readonly="spaceStore.isGitSynced"
                    @refresh="spaceStore.refreshTree"
                />
            </main>
        </div>

        <SpaceSettings
            v-model="showSpaceSettings"
            :space="spaceStore.space"
            :space-id="spaceId"
            @open-update-routes="openUpdateRoutesDialog"
            @open-clone="openCloneSpaceDialog"
        />

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
import { useMobile } from '../composables/useMobile';
import { useSpaceSettings } from '../composables/useSpaceSettings';
import { SPACE_TREE_KEY, firstPageIn } from '../lib/spaceTree.js';
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
