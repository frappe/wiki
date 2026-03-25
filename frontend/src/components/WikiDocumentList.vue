<template>
	<div>
		<div class="flex items-center justify-end mb-4">
			<div class="flex gap-2">
				<Button :title="__('New Group')" icon="folder-plus" variant="subtle" @click="openCreateDialog(rootNode, true)" />
				<Button :title="__('New Page')" icon="file-plus" variant="subtle" @click="openCreateDialog(rootNode, false)" />
				<Button :title="__('External Link')" variant="subtle" @click="openExternalLinkDialog(rootNode)">
					<template #icon>
						<LucideLink class="size-4" />
					</template>
				</Button>
			</div>
		</div>

		<div v-if="!treeData.children || treeData.children.length === 0"
			class="flex flex-col items-center justify-center py-16 border border-dashed border-outline-gray-2 rounded-lg">
			<LucideFileText class="size-12 text-ink-gray-4 mb-4" />
			<h3 class="text-lg font-medium text-ink-gray-7 mb-2">{{ __('No pages yet') }}</h3>
			<p class="text-sm text-ink-gray-5 mb-6">{{ __('Create your first page to get started') }}</p>
			<Button variant="solid" @click="openCreateDialog(rootNode, false)">
				<template #prefix>
					<LucideFilePlus class="size-4" />
				</template>
				{{ __('Create First Page') }}
			</Button>
		</div>

		<div v-else class="border border-outline-gray-2 rounded-lg overflow-hidden">
			<NestedDraggable
				:key="treeKey"
				:items="treeData.children"
				:change-type-map="changeTypeMap"
				:level="0"
				:parent-name="rootNode"
				:space-id="spaceId"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				@create="openCreateDialog"
				@delete="openDeleteDialog"
				@rename="openRenameDialog"
				@external-link="openExternalLinkDialog"
				@edit-external-link="openEditExternalLinkDialog"
				@drag-state-change="handleDragStateChange"
				@update="handleTreeUpdate"
			/>
		</div>

		<Dialog v-model="showCreateDialog">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">
					{{ createIsGroup ? __('Create New Group') : __('Create New Page') }}
				</h3>
			</template>
			<template #body-content>
				<div class="space-y-4">
					<FormControl v-model="createTitle" :label="__('Title')" type="text"
						:placeholder="createIsGroup ? __('Enter group name') : __('Enter page title')" autofocus />
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="crStore.isCreatingPage" @click="createDocument(close)">
						{{ __('Save Draft') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showDeleteDialog">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">
					{{ __('Delete') }} "{{ deleteNode?.title }}"
				</h3>
			</template>
			<template #body-content>
				<div class="space-y-4">
					<p class="text-ink-gray-7">
						{{ __('Are you sure you want to delete this') }}
						{{ deleteNode?.is_group ? __('group') : __('page') }}?
					</p>
					<div v-if="deleteNode?.is_group && deleteChildCount > 0"
						class="bg-surface-orange-1 border border-outline-orange-2 rounded-lg p-4">
						<div class="flex items-start gap-3">
							<LucideAlertTriangle class="size-5 text-ink-orange-4 flex-shrink-0 mt-0.5" />
							<div>
								<p class="font-medium text-ink-orange-4">{{ __('Warning') }}</p>
								<p class="text-sm text-ink-orange-3 mt-1">
									{{ __('This group contains') }} {{ deleteChildCount }}
									{{ deleteChildCount === 1 ? __('child document') : __('child documents') }}
									{{ __('that will also be deleted.') }}
								</p>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" theme="gray" :loading="crStore.isDeletingPage"
						@click="deleteDocument(close)">
						{{ __('Save Delete Draft') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showRenameDialog">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">
					{{ renameNode?.is_group ? __('Rename Group') : __('Change Title') }}
				</h3>
			</template>
			<template #body-content>
				<div class="space-y-4">
					<FormControl v-model="renameTitle" :label="renameNode?.is_group ? __('Name') : __('Title')" type="text"
						:placeholder="renameNode?.is_group ? __('Enter group name') : __('Enter page title')" autofocus />
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="crStore.isUpdatingPage"
						@click="renameDocument(close)">
						{{ __('Save') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showExternalLinkDialog">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">
					{{ __('Add External Link') }}
				</h3>
			</template>
			<template #body-content>
				<div class="space-y-4">
					<FormControl v-model="externalLinkTitle" :label="__('Title')" type="text"
						:placeholder="__('Enter link title')" autofocus />
					<FormControl v-model="externalLinkUrl" :label="__('URL')" type="text"
						:placeholder="__('https://example.com')" />
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="crStore.isCreatingPage" @click="createExternalLink(close)">
						{{ __('Save Draft') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showEditExternalLinkDialog">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">
					{{ __('Edit External Link') }}
				</h3>
			</template>
			<template #body-content>
				<div class="space-y-4">
					<FormControl v-model="editExternalLinkTitle" :label="__('Title')" type="text"
						:placeholder="__('Enter link title')" autofocus />
					<FormControl v-model="editExternalLinkUrl" :label="__('URL')" type="text"
						:placeholder="__('https://example.com')" />
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="crStore.isUpdatingPage" @click="updateExternalLink(close)">
						{{ __('Save') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { ref, computed, watch, toRef, onBeforeUnmount } from 'vue';
import { useStorage } from '@vueuse/core';
import { toast, FormControl } from 'frappe-ui';
import NestedDraggable from './NestedDraggable.vue';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useTreeDialogs } from '@/composables/useTreeDialogs';
import LucideFilePlus from '~icons/lucide/file-plus';
import LucideFileText from '~icons/lucide/file-text';
import LucideAlertTriangle from '~icons/lucide/alert-triangle';
import LucideLink from '~icons/lucide/link';

const props = defineProps({
	treeData: {
		type: Object,
		required: true,
	},
	changeTypeMap: {
		type: Map,
		default: () => new Map(),
	},
	spaceId: {
		type: String,
		required: true,
	},
	rootNode: {
		type: String,
		required: true,
	},
	selectedPageId: {
		type: String,
		default: null,
	},
	selectedDraftKey: {
		type: String,
		default: null,
	},
});

const emit = defineEmits(['refresh', 'reorder-state-change']);
const treeKey = computed(() => {
	const getNodeIds = (nodes) => {
		if (!nodes) return '';
		const keys = nodes.map(n => n.doc_key).sort();
		const childKeys = nodes
			.filter(n => n.children?.length)
			.map(n => n.doc_key + ':' + getNodeIds(n.children))
			.sort();
		return keys.join(',') + '|' + childKeys.join(';');
	};
	return getNodeIds(props.treeData?.children);
});

const crStore = useChangeRequestStore();
const expandedNodes = useStorage('wiki-tree-expanded-nodes', {});

const {
	showCreateDialog, createTitle, createIsGroup,
	showDeleteDialog, deleteNode, deleteChildCount,
	showRenameDialog, renameTitle, renameNode,
	showExternalLinkDialog, externalLinkTitle, externalLinkUrl,
	showEditExternalLinkDialog, editExternalLinkTitle, editExternalLinkUrl,
	openCreateDialog, openDeleteDialog, createDocument, deleteDocument,
	openRenameDialog, renameDocument,
	openExternalLinkDialog, createExternalLink,
	openEditExternalLinkDialog, updateExternalLink,
} = useTreeDialogs(toRef(props, 'spaceId'), expandedNodes, emit);

let reorderTimer = null;
let pendingReorder = null;
let reorderInFlight = false;
const isDragActive = ref(false);
const isReorderBusy = ref(false);
const isReorderActive = computed(() => isDragActive.value || isReorderBusy.value);

watch(
	isReorderActive,
	(value) => {
		emit('reorder-state-change', value);
	},
	{ immediate: true },
);

function handleDragStateChange(isDragging) {
	isDragActive.value = isDragging;
}

function handleTreeUpdate(payload) {
	if (payload.type === 'refresh') {
		emit('refresh');
		return;
	}

	if (payload.type === 'added' || payload.type === 'moved') {
		isReorderBusy.value = true;
		pendingReorder = payload;
		if (reorderTimer) clearTimeout(reorderTimer);
		reorderTimer = setTimeout(() => {
			reorderTimer = null;
			flushReorder();
		}, 1000);
	}
}

async function flushReorder() {
	if (reorderInFlight) return;
	if (!pendingReorder) {
		if (!reorderTimer) isReorderBusy.value = false;
		return;
	}

	const payload = pendingReorder;
	pendingReorder = null;
	reorderInFlight = true;

	try {
		await applyReorder(payload);
	} catch (error) {
		emit('refresh');
	} finally {
		reorderInFlight = false;
		if (pendingReorder) {
			flushReorder();
		} else if (!reorderTimer) {
			isReorderBusy.value = false;
		}
	}
}

async function applyReorder(payload) {
	if (!(await crStore.ensureChangeRequest(props.spaceId))) {
		toast.error(__('Could not create change request'));
		return;
	}

	const siblingKeys = payload.siblings.map(s => s.doc_key);
	await crStore.movePage(
		crStore.currentChangeRequest.name,
		payload.item.doc_key,
		payload.newParent,
		payload.newIndex,
	);
	await crStore.reorderChildren(
		crStore.currentChangeRequest.name,
		payload.newParent,
		siblingKeys,
	);
	toast.success(__('Documents reordered'));
	emit('refresh');
}

onBeforeUnmount(() => {
	if (reorderTimer) {
		clearTimeout(reorderTimer);
		reorderTimer = null;
	}
	pendingReorder = null;
	reorderInFlight = false;
	isDragActive.value = false;
	isReorderBusy.value = false;
	emit('reorder-state-change', false);
});
</script>
