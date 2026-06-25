<template>
    <div class="flex h-full">
        <aside
            ref="sidebarRef"
            class="border-r border-outline-gray-2 flex flex-col bg-surface-gray-1 relative flex-shrink-0"
            :style="{ width: `${sidebarWidth}px` }"
        >
            <!-- Header -->
            <div class="p-4 border-b border-outline-gray-2">
                <div class="flex items-center justify-between mb-3">
                    <Button
                        variant="ghost"
                        icon-left="arrow-left"
                        :route="{ name: 'SpaceList' }"
                    >
                        {{ __('Back to Spaces') }}
                    </Button>
                    <Button
                        variant="ghost"
                        icon="settings"
                        :title="__('Settings')"
                        @click="showSettingsDialog = true"
                    />
                </div>
                <div class="flex items-center gap-2">
                    <h1 class="text-lg font-semibold text-ink-gray-9">
                        {{ space.doc?.space_name || spaceId }}
                    </h1>
                    <Button
                        v-if="space.doc?.route"
                        variant="ghost"
                        icon="external-link"
                        :title="__('View Space')"
                        :link="'/' + space.doc?.route"
                    />
                </div>
                <p class="text-sm text-ink-gray-5 mt-0.5">{{ space.doc?.route }}</p>
            </div>

            <div v-if="space.doc && treeData" class="flex-1 overflow-auto p-2">
                <WikiDocumentList
                    :tree-data="treeData"
                    :change-type-map="changeTypeMap"
                    :space-id="spaceId"
                    :readonly="isGitSynced"
                    :root-node="treeData.root_group || ''"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    @refresh="refreshTree"
                    @reorder-state-change="handleReorderStateChange"
                />
            </div>
            <div v-else class="flex-1 overflow-auto p-2">
                <!-- Sidebar tree skeleton -->
                <div class="space-y-1 animate-pulse">
                    <div v-for="i in 8" :key="i" class="flex items-center gap-2 px-2 py-1.5 rounded">
                        <div class="size-4 rounded bg-surface-gray-3 shrink-0" />
                        <div class="h-3.5 rounded bg-surface-gray-3" :style="{ width: `${60 + (i % 3) * 25}%` }" />
                    </div>
                    <div v-for="i in 4" :key="'nested-' + i" class="flex items-center gap-2 px-2 py-1.5 rounded ml-6">
                        <div class="size-4 rounded bg-surface-gray-3 shrink-0" />
                        <div class="h-3.5 rounded bg-surface-gray-3" :style="{ width: `${50 + (i % 2) * 30}%` }" />
                    </div>
                </div>
            </div>

            <div
                class="absolute top-0 right-0 w-1 h-full cursor-col-resize"
                :class="sidebarResizing ? 'bg-surface-gray-4' : 'hover:bg-surface-gray-4'"
                @mousedown="startResize"
            />
        </aside>

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
                                {{ space.doc?.last_sync_status || __('Pending') }}
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
import LucideRefreshCw from '~icons/lucide/refresh-cw';
import ContributionBanner from '../components/ContributionBanner.vue';
import SpaceSettings from '../components/SpaceSettings/SpaceSettings.vue';
import WikiDocumentList from '../components/WikiDocumentList.vue';
import { useSidebarResize } from '../composables/useSidebarResize';
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
});
onBeforeUnmount(() => {
	delete window.__draftStore;
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

const readonlyTreeResource = createResource({
	url: 'wiki.api.wiki_space.get_wiki_tree',
});

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
	await readonlyTreeResource.submit({ space_id: props.spaceId });
}

async function syncNow({ silent = false } = {}) {
	syncing.value = true;
	try {
		await space.syncNow.submit();
		if (!silent) toast.success(__('Sync started — pulling the latest from GitHub'));
		// The sync runs on the long queue; give it a moment, then refresh the
		// tree so the user sees the result without a manual reload.
		setTimeout(async () => {
			try {
				await Promise.all([space.reload(), loadReadonlyTree()]);
			} finally {
				syncing.value = false;
			}
		}, 4000);
	} catch (error) {
		syncing.value = false;
		toast.error(error.messages?.[0] || __('Could not start sync'));
	}
}

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
	if (isGitSynced.value) return readonlyTreeData.value;
	return draftStore.hasLoadedTree ? draftStore.treeAsLegacy : null;
});

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
			const node = findNodeByDocKey(treeData.value?.children, docKey);
			if (node?.document_name) {
				router.push({
					name: 'SpacePage',
					params: { spaceId: props.spaceId, pageId: node.document_name },
				});
			}
		}
	} catch (error) {
		// A merge conflict leaves the CR Approved; the conflict-resolution UI
		// lives on the review page, so send the author there to resolve it.
		if (error.exc_type === 'ValidationError' && changeRequestName) {
			toast.error(error.messages?.[0] || __('Merge conflict — resolve it to continue'));
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
