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
					<Button variant="solid" :loading="createPageResource.loading" @click="createDocument(close)">
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
					<Button variant="solid" theme="gray" :loading="deletePageResource.loading"
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
					<Button variant="solid" :loading="updatePageResource.loading"
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
					<Button variant="solid" :loading="createPageResource.loading" @click="createExternalLink(close)">
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
					<Button variant="solid" :loading="updatePageResource.loading" @click="updateExternalLink(close)">
						{{ __('Save') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { ref, toRef, computed } from 'vue';
import { useStorage } from '@vueuse/core';
import { toast, FormControl } from 'frappe-ui';
import NestedDraggable from './NestedDraggable.vue';
import { useChangeRequestMode, useChangeRequest, currentChangeRequest } from '@/composables/useChangeRequest';
import LucideFilePlus from '~icons/lucide/file-plus';
import LucideFileText from '~icons/lucide/file-text';
import LucideAlertTriangle from '~icons/lucide/alert-triangle';
import LucideLink from '~icons/lucide/link';

const props = defineProps({
	treeData: {
		type: Object,
		required: true,
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

const emit = defineEmits(['refresh']);
const treeKey = computed(() => {
	const getNodeIds = (nodes) => {
		if (!nodes) return '';
		return nodes.map(n => n.doc_key + (n.children ? getNodeIds(n.children) : '')).join(',');
	};
	return getNodeIds(props.treeData?.children);
});

const spaceIdRef = toRef(props, 'spaceId');
const {
	initChangeRequest,
	loadChanges,
} = useChangeRequestMode(spaceIdRef);

const {
	createPage,
	createPageResource,
	updatePage,
	updatePageResource,
	deletePage,
	deletePageResource,
	movePage,
	reorderChildren,
} = useChangeRequest();

const expandedNodes = useStorage('wiki-tree-expanded-nodes', {});

const showCreateDialog = ref(false);
const createTitle = ref('');
const createParent = ref(null);
const createIsGroup = ref(false);

const showDeleteDialog = ref(false);
const deleteNode = ref(null);
const deleteChildCount = ref(0);

const showRenameDialog = ref(false);
const renameTitle = ref('');
const renameNode = ref(null);

const showExternalLinkDialog = ref(false);
const externalLinkTitle = ref('');
const externalLinkUrl = ref('');
const externalLinkParent = ref(null);

const showEditExternalLinkDialog = ref(false);
const editExternalLinkTitle = ref('');
const editExternalLinkUrl = ref('');
const editExternalLinkNode = ref(null);

function handleTreeUpdate(payload) {
	if (payload.type === 'refresh') {
		emit('refresh');
		return;
	}

	if (payload.type === 'added' || payload.type === 'moved') {
		applyReorder(payload).catch((error) => {
			console.error('Error reordering:', error);
			toast.error(error.messages?.[0] || __('Error reordering documents'));
			emit('refresh');
		});
	}
}

async function applyReorder(payload) {
	if (!currentChangeRequest.value) {
		await initChangeRequest();
	}
	if (!currentChangeRequest.value) {
		toast.error(__('Could not create change request'));
		return;
	}

	const siblingKeys = payload.siblings.map(s => s.doc_key);
	await movePage(
		currentChangeRequest.value.name,
		payload.item.doc_key,
		payload.newParent,
		payload.newIndex,
	);
	await reorderChildren(
		currentChangeRequest.value.name,
		payload.newParent,
		siblingKeys,
	);
	if (payload?.item && !payload.item._changeType) {
		payload.item._changeType = 'reordered';
	}
	toast.success(__('Documents reordered'));
	await loadChanges();
	emit('refresh');
}

function openCreateDialog(parentKey, isGroup) {
	createParent.value = parentKey;
	createIsGroup.value = isGroup;
	createTitle.value = '';
	showCreateDialog.value = true;
}

function countDescendants(node) {
	if (!node?.children?.length) return 0;
	return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function openDeleteDialog(node) {
	deleteNode.value = node;
	deleteChildCount.value = node?.is_group ? countDescendants(node) : 0;
	showDeleteDialog.value = true;
}

async function createDocument(close) {
	if (!createTitle.value.trim()) {
		toast.warning(__('Title is required'));
		return;
	}

	try {
		if (!currentChangeRequest.value) {
			await initChangeRequest();
		}

		if (!currentChangeRequest.value) {
			toast.error(__('Could not create change request'));
			return;
		}

		await createPage(
			currentChangeRequest.value.name,
			createParent.value,
			createTitle.value.trim(),
			'',
			createIsGroup.value,
		);

		toast.success(createIsGroup.value ? __('Group draft created') : __('Page draft created'));

		if (createParent.value) {
			expandedNodes.value[createParent.value] = true;
		}

		await loadChanges();
		emit('refresh');
		close();
	} catch (error) {
		console.error('Error creating page:', error);
		toast.error(error.messages?.[0] || __('Error creating draft'));
	}
}

async function deleteDocument(close) {
	try {
		if (!currentChangeRequest.value) {
			await initChangeRequest();
		}

		if (!currentChangeRequest.value) {
			toast.error(__('Could not create change request'));
			return;
		}

		await deletePage(currentChangeRequest.value.name, deleteNode.value.doc_key);

		toast.success(__('Delete saved as draft'));
		await loadChanges();
		emit('refresh');
		close();
	} catch (error) {
		console.error('Error creating delete draft:', error);
		toast.error(error.messages?.[0] || __('Error creating draft'));
	}
}

function openRenameDialog(node) {
	renameNode.value = node;
	renameTitle.value = node.title || '';
	showRenameDialog.value = true;
}

async function renameDocument(close) {
	if (!renameTitle.value.trim()) {
		toast.warning(__('Name is required'));
		return;
	}

	try {
		if (!currentChangeRequest.value) {
			await initChangeRequest();
		}

		if (!currentChangeRequest.value) {
			toast.error(__('Could not create change request'));
			return;
		}

		await updatePage(currentChangeRequest.value.name, renameNode.value.doc_key, {
			title: renameTitle.value.trim(),
		});
		toast.success(renameNode.value?.is_group ? __('Group renamed') : __('Title updated'));
		await loadChanges();
		emit('refresh');
		close();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating title'));
	}
}

function openExternalLinkDialog(parentKey) {
	externalLinkParent.value = parentKey;
	externalLinkTitle.value = '';
	externalLinkUrl.value = '';
	showExternalLinkDialog.value = true;
}

async function createExternalLink(close) {
	if (!externalLinkTitle.value.trim()) {
		toast.warning(__('Title is required'));
		return;
	}

	if (!externalLinkUrl.value.trim()) {
		toast.warning(__('URL is required'));
		return;
	}

	try {
		if (!currentChangeRequest.value) {
			await initChangeRequest();
		}

		if (!currentChangeRequest.value) {
			toast.error(__('Could not create change request'));
			return;
		}

		await createPage(
			currentChangeRequest.value.name,
			externalLinkParent.value,
			externalLinkTitle.value.trim(),
			'',
			false,
			true,
			externalLinkUrl.value.trim(),
		);

		toast.success(__('External link draft created'));

		if (externalLinkParent.value) {
			expandedNodes.value[externalLinkParent.value] = true;
		}

		await loadChanges();
		emit('refresh');
		close();
	} catch (error) {
		console.error('Error creating external link:', error);
		toast.error(error.messages?.[0] || __('Error creating draft'));
	}
}

function openEditExternalLinkDialog(node) {
	editExternalLinkNode.value = node;
	editExternalLinkTitle.value = node.title || '';
	editExternalLinkUrl.value = node.external_url || '';
	showEditExternalLinkDialog.value = true;
}

async function updateExternalLink(close) {
	if (!editExternalLinkTitle.value.trim()) {
		toast.warning(__('Title is required'));
		return;
	}

	if (!editExternalLinkUrl.value.trim()) {
		toast.warning(__('URL is required'));
		return;
	}

	try {
		if (!currentChangeRequest.value) {
			await initChangeRequest();
		}

		if (!currentChangeRequest.value) {
			toast.error(__('Could not create change request'));
			return;
		}

		await updatePage(currentChangeRequest.value.name, editExternalLinkNode.value.doc_key, {
			title: editExternalLinkTitle.value.trim(),
			external_url: editExternalLinkUrl.value.trim(),
		});

		toast.success(__('External link updated'));
		await loadChanges();
		emit('refresh');
		close();
	} catch (error) {
		console.error('Error updating external link:', error);
		toast.error(error.messages?.[0] || __('Error updating external link'));
	}
}
</script>
