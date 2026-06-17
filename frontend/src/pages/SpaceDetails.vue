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
                class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10"
                :class="sidebarResizing ? 'bg-surface-gray-4' : 'hover:bg-surface-gray-4'"
                @mousedown="startResize"
            />
        </aside>

        <main class="flex-1 flex flex-col bg-surface-white min-w-0">
            <ContributionBanner
                :mergeDisabled="isTreeReordering"
                @submit="handleSubmitChangeRequest"
                @withdraw="handleArchiveChangeRequest"
                @merge="handleMergeChangeRequest"
            />
            <div class="flex-1 overflow-auto">
                <router-view
                    :space-id="spaceId"
                    @refresh="refreshTree"
                />
            </div>
        </main>

        <Dialog v-model="showSettingsDialog">
            <template #body-title>
                <h3 class="text-xl font-semibold text-ink-gray-9">
                    {{ __('Space Settings') }}
                </h3>
            </template>
            <template #body-content>
                <div class="space-y-4 py-2">
                    <div class="flex items-center justify-between p-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1">
                        <div class="flex-1 mr-4">
                            <p class="text-sm font-medium text-ink-gray-9">
                                {{ __('Published') }}
                            </p>
                            <p class="text-xs text-ink-gray-5 mt-0.5">
                                {{ __('Make this wiki space publicly accessible') }}
                            </p>
                        </div>
                        <Switch
                            v-model="isPublished"
                            :disabled="updatingPublishSetting"
                            @update:modelValue="updatePublishSetting"
                        />
                    </div>
                    <div class="flex items-center justify-between p-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1">
                        <div class="flex-1 mr-4">
                            <p class="text-sm font-medium text-ink-gray-9">
                                {{ __('Enable Feedback Collection') }}
                            </p>
                            <p class="text-xs text-ink-gray-5 mt-0.5">
                                {{ __('Show a feedback widget on wiki pages to collect user reactions') }}
                            </p>
                        </div>
                        <Switch
                            v-model="enableFeedbackCollection"
                            :disabled="updatingFeedbackSetting"
                            @update:modelValue="updateFeedbackSetting"
                        />
                    </div>
                    <div class="flex items-center justify-between p-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1">
                        <div class="flex-1 mr-4">
                            <p class="text-sm font-medium text-ink-gray-9">
                                {{ __('Bulk Update Routes') }}
                            </p>
                            <p class="text-xs text-ink-gray-5 mt-0.5">
                                {{ __('Change the base route for this space and all its pages') }}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            @click="openUpdateRoutesDialog"
                        >
                            {{ __('Update') }}
                        </Button>
                    </div>
                    <div class="flex items-center justify-between p-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1">
                        <div class="flex-1 mr-4">
                            <p class="text-sm font-medium text-ink-gray-9">
                                {{ __('Clone Space') }}
                            </p>
                            <p class="text-xs text-ink-gray-5 mt-0.5">
                                {{ __('Create a new space with the same structure') }}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            @click="openCloneSpaceDialog"
                        >
                            {{ __('Clone') }}
                        </Button>
                    </div>
                    <div class="p-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1">
                        <p class="text-sm font-medium text-ink-gray-9">
                            {{ __('Access Control') }}
                        </p>
                        <p class="text-xs text-ink-gray-5 mt-0.5">
                            {{ __('Leave empty for open access to all logged-in users. Add the Guest role for public/anonymous access.') }}
                        </p>
                        <div class="mt-3 space-y-2">
                            <div
                                v-for="(row, idx) in roleRows"
                                :key="idx"
                                class="flex items-center gap-2"
                            >
                                <span class="flex-1 text-sm text-ink-gray-8">{{ row.role }}</span>
                                <Badge size="sm" :theme="row.permission_level === 'Write' ? 'green' : 'gray'">
                                    {{ row.permission_level }}
                                </Badge>
                                <Button v-if="canManageAccess" variant="ghost" size="sm" icon="x" @click="removeRole(idx)" />
                            </div>
                            <p v-if="!roleRows.length" class="text-xs text-ink-gray-5">
                                {{ __('No roles configured (open to all logged-in users).') }}
                            </p>
                        </div>
                        <template v-if="canManageAccess">
                            <div class="mt-3 flex items-end gap-2">
                                <FormControl
                                    class="flex-1"
                                    type="select"
                                    :label="__('Role')"
                                    :options="roleOptions"
                                    v-model="newRole.role"
                                />
                                <FormControl
                                    type="select"
                                    :label="__('Access')"
                                    :options="['Read', 'Write']"
                                    v-model="newRole.permission_level"
                                />
                                <Button variant="subtle" @click="addRole">{{ __('Add') }}</Button>
                            </div>
                            <div class="mt-3 flex justify-end">
                                <Button
                                    variant="solid"
                                    size="sm"
                                    :loading="savingRoles"
                                    @click="saveRoles"
                                >
                                    {{ __('Save Roles') }}
                                </Button>
                            </div>
                        </template>
                        <p v-else class="mt-3 text-xs text-ink-gray-5">
                            {{ __('Only space admins can change access control.') }}
                        </p>
                    </div>
                </div>
            </template>
            <template #actions="{ close }">
                <div class="flex justify-end">
                    <Button variant="outline" @click="close">{{ __('Close') }}</Button>
                </div>
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
	Switch,
	createDocumentResource,
	createListResource,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ContributionBanner from '../components/ContributionBanner.vue';
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

const enableFeedbackCollection = ref(false);
const updatingFeedbackSetting = ref(false);

const isPublished = ref(true);
const updatingPublishSetting = ref(false);

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
	},
});

// --- Access control (roles) editor ---
const roleRows = ref([]);
const newRole = reactive({ role: '', permission_level: 'Read' });

// Only users who can write the space may edit its access control (mirrors the
// server-side check in update_space_roles). Read-tier users see it read-only.
const canManageAccess = ref(false);
const spaceCapabilities = createResource({
	url: 'wiki.api.get_space_capabilities',
	onSuccess: (data) => {
		canManageAccess.value = Boolean(data?.can_write);
	},
});

watch(
	() => space.doc,
	(doc) => {
		if (doc) {
			enableFeedbackCollection.value = Boolean(doc.enable_feedback_collection);
			isPublished.value = Boolean(doc.is_published);
			roleRows.value = (doc.roles || []).map((row) => ({
				role: row.role,
				permission_level: row.permission_level,
			}));
			spaceCapabilities.submit({ space: props.spaceId });
		}
	},
	{ immediate: true },
);
const savingRoles = ref(false);

const allRoles = createListResource({
	doctype: 'Role',
	fields: ['name'],
	filters: [['disabled', '=', 0]],
	pageLength: 0,
	auto: true,
});
const roleOptions = computed(() => (allRoles.data || []).map((r) => r.name).sort());

function addRole() {
	if (!newRole.role) return;
	if (roleRows.value.some((r) => r.role === newRole.role)) {
		// Upgrade the existing row's level instead of duplicating it.
		roleRows.value = roleRows.value.map((r) =>
			r.role === newRole.role ? { ...r, permission_level: newRole.permission_level } : r,
		);
	} else {
		roleRows.value.push({ role: newRole.role, permission_level: newRole.permission_level });
	}
	newRole.role = '';
	newRole.permission_level = 'Read';
}

function removeRole(idx) {
	roleRows.value.splice(idx, 1);
}

const updateRolesResource = createResource({
	url: 'wiki.api.wiki_space.update_space_roles',
});

async function saveRoles() {
	savingRoles.value = true;
	try {
		await updateRolesResource.submit({
			space_id: props.spaceId,
			roles: roleRows.value,
		});
		await space.reload();
		toast.success(__('Access control updated'));
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to update access control'));
	} finally {
		savingRoles.value = false;
	}
}

async function updateFeedbackSetting(value) {
	updatingFeedbackSetting.value = true;
	try {
		await space.setValue.submit({
			enable_feedback_collection: value ? 1 : 0,
		});
	} catch (error) {
		console.error('Failed to update feedback setting:', error);
		enableFeedbackCollection.value = !value;
	} finally {
		updatingFeedbackSetting.value = false;
	}
}

async function updatePublishSetting(value) {
	updatingPublishSetting.value = true;
	try {
		await space.setValue.submit({
			is_published: value ? 1 : 0,
		});
	} catch (error) {
		console.error('Failed to update publish setting:', error);
		isPublished.value = !value;
	} finally {
		updatingPublishSetting.value = false;
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
const treeData = computed(() =>
	draftStore.hasLoadedTree ? draftStore.treeAsLegacy : null,
);

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

		const [oldDoc] = oldValues || [];
		if (doc !== oldDoc) {
			crStore.currentChangeRequest = null;
			draftStore.reset();
		}

		await draftStore.hydrate(props.spaceId);
	},
	{ immediate: true },
);

async function refreshTree() {
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
	try {
		await crStore.archiveChangeRequest();
		toast.success(__('Change request archived'));
		crStore.currentChangeRequest = null;
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
	try {
		await crStore.mergeChangeRequest();
		toast.success(__('Change request merged'));
		crStore.currentChangeRequest = null;
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
		toast.error(error.messages?.[0] || __('Error merging change request'));
	}
}
</script>
