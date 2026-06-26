<template>
	<div>
		<div class="flex items-center gap-2 mb-4">
			<FormControl v-if="treeData.children && treeData.children.length > 0" class="flex-1" type="text"
				v-model="searchQuery" :placeholder="__('Search pages...')" @keydown.esc="searchQuery = ''">
				<template #prefix>
					<LucideSearch class="size-4 text-ink-gray-4" />
				</template>
				<template v-if="searchQuery" #suffix>
					<button class="flex" :title="__('Clear search')" @click="searchQuery = ''">
						<LucideX class="size-4 text-ink-gray-5 hover:text-ink-gray-7" />
					</button>
				</template>
			</FormControl>
			<div v-if="!readonly" class="flex gap-2 ml-auto">
				<Button :title="__('New Group')" icon="folder-plus" variant="subtle" @click="openCreateDialog(rootNode, true)" />
				<Button :title="__('New Page')" icon="file-plus" variant="subtle" @click="openCreateDialog(rootNode, false)" />
				<Button :title="__('External Link')" variant="subtle" @click="openExternalLinkDialog(rootNode)">
					<template #icon>
						<LucideLink class="size-4" />
					</template>
				</Button>
			</div>
		</div>

		<div v-if="isSearching && !hasResults"
			class="flex flex-col items-center justify-center py-16 border border-dashed border-outline-gray-2 rounded-lg">
			<LucideSearch class="size-12 text-ink-gray-4 mb-4" />
			<h3 class="text-lg font-medium text-ink-gray-7 mb-2">{{ __('No matches') }}</h3>
			<p class="text-sm text-ink-gray-5">{{ __('No pages or groups match "{0}"', [searchQuery]) }}</p>
		</div>

		<div v-else-if="!treeData.children || treeData.children.length === 0"
			class="flex flex-col items-center justify-center py-16 border border-dashed border-outline-gray-2 rounded-lg">
			<LucideFileText class="size-12 text-ink-gray-4 mb-4" />
			<h3 class="text-lg font-medium text-ink-gray-7 mb-2">{{ __('No pages yet') }}</h3>
			<template v-if="!readonly">
				<p class="text-sm text-ink-gray-5 mb-6">{{ __('Create your first page to get started') }}</p>
				<Button variant="solid" @click="openCreateDialog(rootNode, false)">
					<template #prefix>
						<LucideFilePlus class="size-4" />
					</template>
					{{ __('Create First Page') }}
				</Button>
			</template>
			<p v-else class="text-sm text-ink-gray-5">{{ __('No pages have synced from the repository yet') }}</p>
		</div>

		<div v-else class="border border-outline-gray-2 rounded-lg overflow-hidden">
			<NestedDraggable
				:key="treeKey"
				:items="treeForRender.children"
				:change-type-map="changeTypeMap"
				:level="0"
				:parent-name="rootNode"
				:space-id="spaceId"
				:readonly="readonly"
				:search-active="isSearching"
				:expanded-override="expandedOverride"
				:score-map="scoreMap"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				@create="openCreateDialog"
				@delete="openDeleteDialog"
				@rename="openRenameDialog"
				@external-link="openExternalLinkDialog"
				@edit-external-link="openEditExternalLinkDialog"
				@drag-state-change="handleDragStateChange"
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
					<Button variant="solid" :loading="isCreating" @click="createDocument(close)">
						{{ __('Save') }}
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
					<Button variant="solid" theme="gray" :loading="isDeleting"
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
					<Button variant="solid" :loading="isRenaming"
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
					<Button variant="solid" :loading="isCreating" @click="createExternalLink(close)">
						{{ __('Save') }}
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
					<Button variant="solid" :loading="isUpdatingExternalLink" @click="updateExternalLink(close)">
						{{ __('Save') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { useTreeDialogs } from '@/composables/useTreeDialogs';
import { useTreeSearch } from '@/composables/useTreeSearch';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useStorage } from '@vueuse/core';
import { FormControl } from 'frappe-ui';
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue';
import LucideAlertTriangle from '~icons/lucide/alert-triangle';
import LucideFilePlus from '~icons/lucide/file-plus';
import LucideFileText from '~icons/lucide/file-text';
import LucideLink from '~icons/lucide/link';
import LucideSearch from '~icons/lucide/search';
import LucideX from '~icons/lucide/x';
import NestedDraggable from './NestedDraggable.vue';

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
		// Empty string while hydration is in flight; populated once
		// draftStore.rootKey is set. createNode falls back to rootKey
		// internally when this is empty, so it's safe to pass through.
		type: String,
		default: '',
	},
	// Git-synced spaces render the tree read-only — no create/reorder/row
	// actions. The dialogs below stay mounted but are never opened.
	readonly: {
		type: Boolean,
		default: false,
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

const emit = defineEmits(['reorder-state-change']);
const treeKey = computed(() => {
	const getNodeIds = (nodes) => {
		if (!nodes) return '';
		const keys = nodes.map((n) => n.doc_key).sort();
		const childKeys = nodes
			.filter((n) => n.children?.length)
			.map((n) => n.doc_key + ':' + getNodeIds(n.children))
			.sort();
		return keys.join(',') + '|' + childKeys.join(';');
	};
	return getNodeIds(props.treeData?.children);
});

const draftStore = useDraftWorkspaceStore();
const expandedNodes = useStorage('wiki-tree-expanded-nodes', {});

// Client-side fuzzy filter over the in-memory tree (title + route).
const {
	query: searchQuery,
	isSearching,
	treeForRender,
	hasResults,
	expandedOverride,
	scoreMap,
} = useTreeSearch(toRef(props, 'treeData'));

const {
	showCreateDialog,
	createTitle,
	createIsGroup,
	showDeleteDialog,
	deleteNode,
	deleteChildCount,
	showRenameDialog,
	renameTitle,
	renameNode,
	showExternalLinkDialog,
	externalLinkTitle,
	externalLinkUrl,
	showEditExternalLinkDialog,
	editExternalLinkTitle,
	editExternalLinkUrl,
	isCreating,
	isRenaming,
	isDeleting,
	isUpdatingExternalLink,
	openCreateDialog,
	openDeleteDialog,
	createDocument,
	deleteDocument,
	openRenameDialog,
	renameDocument,
	openExternalLinkDialog,
	createExternalLink,
	openEditExternalLinkDialog,
	updateExternalLink,
} = useTreeDialogs(toRef(props, 'spaceId'), expandedNodes);

// Reorder is owned by the draft workspace store: drag events mutate the
// store's tree synchronously and the store debounces the backend sync. We
// only need to surface "is something pending?" to the parent so it can
// gate merge while the queue drains.
const isDragActive = ref(false);
const isReorderBusy = computed(() =>
	draftStore.pending.some(
		(m) => m.type === 'move_node' && m.status !== 'failed',
	),
);
const isReorderActive = computed(
	() => isDragActive.value || isReorderBusy.value,
);

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

onBeforeUnmount(() => {
	isDragActive.value = false;
	emit('reorder-state-change', false);
});
</script>
