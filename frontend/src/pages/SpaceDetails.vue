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

            <div v-if="space.doc && mergedTreeData" class="flex-1 overflow-auto p-2">
                <WikiDocumentList
                    :tree-data="mergedTreeData"
                    :space-id="spaceId"
                    :root-node="mergedTreeData.root_group || space.doc.root_group"
                    :selected-page-id="currentPageId"
                    :selected-draft-key="currentDraftKey"
                    @refresh="refreshTree"
                />
            </div>

            <div
                class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10"
                :class="sidebarResizing ? 'bg-surface-gray-4' : 'hover:bg-surface-gray-4'"
                @mousedown="startResize"
            />
        </aside>

        <main class="flex-1 flex flex-col bg-surface-white min-w-0">
            <ContributionBanner
                :isChangeRequestMode="isChangeRequestMode"
                :changeRequestStatus="currentChangeRequest?.status || 'Draft'"
                :changeCount="changeCount"
                :changes="changesResource.data || []"
                :submitReviewResource="submitReviewResource"
                :archiveChangeRequestResource="archiveChangeRequestResource"
                :mergeResource="mergeChangeRequestResource"
                :canMerge="isManager"
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
import { ref, computed, watch, toRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createDocumentResource, createResource, Button, Dialog, Switch, FormControl, toast } from 'frappe-ui';
import WikiDocumentList from '../components/WikiDocumentList.vue';
import ContributionBanner from '../components/ContributionBanner.vue';
import { useSidebarResize } from '../composables/useSidebarResize';
import { useChangeRequestMode, currentChangeRequest, isWikiManager } from '../composables/useChangeRequest';

const props = defineProps({
    spaceId: {
        type: String,
        required: true,
    },
});

const route = useRoute();

const router = useRouter();
const spaceIdRef = toRef(props, 'spaceId');
const {
    isChangeRequestMode,
    changeCount,
    changesResource,
    initChangeRequest,
    loadChanges,
    submitReviewResource,
    archiveChangeRequestResource,
    mergeChangeRequestResource,
    submitForReview,
    archiveChangeRequest,
    mergeChangeRequest,
} = useChangeRequestMode(spaceIdRef);

const isManager = computed(() => isWikiManager());

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
const { sidebarWidth, sidebarResizing, startResize } = useSidebarResize(sidebarRef);

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

watch(() => space.doc, (doc) => {
    if (doc) {
        enableFeedbackCollection.value = Boolean(doc.enable_feedback_collection);
        isPublished.value = Boolean(doc.is_published);
    }
}, { immediate: true });

async function updateFeedbackSetting(value) {
    updatingFeedbackSetting.value = true;
    try {
        await space.setValue.submit({
            enable_feedback_collection: value ? 1 : 0
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
            is_published: value ? 1 : 0
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
        await space.cloneWikiSpace.submit({ new_space_route: cloneRoute.value.trim() });
        toast.success(__('Cloning started in background'));
        close();
    } catch (error) {
        console.error('Failed to start clone:', error);
        toast.error(error.messages?.[0] || __('Error starting clone'));
    } finally {
        cloningSpace.value = false;
    }
}

const crTree = createResource({
    url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
    makeParams() {
        if (!currentChangeRequest.value?.name) {
            return null;
        }
        return { name: currentChangeRequest.value.name };
    },
    auto: false,
});

const mergedTreeData = computed(() => {
    const tree = crTree.data;
    if (!tree) {
        return tree;
    }

    const clonedTree = JSON.parse(JSON.stringify(tree));
    const changeMap = new Map((changesResource.data || []).map((change) => [change.doc_key, change]));

    const applyChanges = (nodes) => {
        if (!nodes) return;
        for (const node of nodes) {
            const change = changeMap.get(node.doc_key);
            if (change) {
                node._changeType = change.change_type;
            }
            if (node.children) {
                applyChanges(node.children);
            }
        }
    };

    applyChanges(clonedTree.children || []);
    return clonedTree;
});

watch([() => space.doc, isChangeRequestMode], async ([doc, isMode]) => {
    if (doc && isMode) {
        currentChangeRequest.value = null;
        await initChangeRequest();
        await loadChanges();
        if (currentChangeRequest.value?.name) {
            await crTree.reload();
        }
    }
}, { immediate: true });

watch(() => currentChangeRequest.value?.name, async (name) => {
    if (name) {
        await loadChanges();
        await crTree.reload();
    }
});

async function refreshTree() {
    if (!currentChangeRequest.value?.name) {
        return;
    }
    await crTree.reload();
    await loadChanges();
}

async function handleSubmitChangeRequest() {
    try {
        const result = await submitForReview();
        toast.success(__('Change request submitted for review'));
        if (result?.name) {
            router.push({ name: 'ChangeRequestReview', params: { changeRequestId: result.name } });
        }
    } catch (error) {
        toast.error(error.messages?.[0] || __('Error submitting for review'));
    }
}

async function handleArchiveChangeRequest() {
    try {
        await archiveChangeRequest();
        toast.success(__('Change request archived'));
        currentChangeRequest.value = null;
        await initChangeRequest();
        await loadChanges();
        await refreshTree();
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
    const docKey = currentDraftKey.value;
    try {
        await mergeChangeRequest();
        toast.success(__('Change request merged'));
        currentChangeRequest.value = null;
        await initChangeRequest();
        await loadChanges();
        await refreshTree();

        if (docKey) {
            const node = findNodeByDocKey(mergedTreeData.value?.children, docKey);
            if (node?.document_name) {
                router.push({ name: 'SpacePage', params: { spaceId: props.spaceId, pageId: node.document_name } });
            }
        }
    } catch (error) {
        toast.error(error.messages?.[0] || __('Error merging change request'));
    }
}
</script>
