<template>
	<div>
		<div class="flex items-center gap-2 mb-3">
			<FormControl v-if="treeData.children && treeData.children.length > 0" class="flex-1" type="text"
				v-model="searchQuery" :placeholder="__('Search pages...')" @keydown.esc="searchQuery = ''">
				<template #prefix>
					<span class="lucide-search size-4 text-ink-gray-4" aria-hidden="true" />
				</template>
				<template v-if="searchQuery" #suffix>
					<button class="flex" :title="__('Clear search')" @click="searchQuery = ''">
						<span class="lucide-x size-4 text-ink-gray-5 hover:text-ink-gray-7" aria-hidden="true" />
					</button>
				</template>
			</FormControl>
			<Dropdown v-if="!readonly" class="ml-auto" :options="addOptionsWithTab">
				<Button :title="__('Add')" icon="plus" variant="subtle" />
			</Dropdown>
		</div>

		<div v-if="isSearching && !hasResults"
			class="flex flex-col items-center justify-center py-16 border border-dashed border-outline-gray-2 rounded-lg">
			<span class="lucide-search size-12 text-ink-gray-4 mb-4" aria-hidden="true" />
			<h3 class="text-lg-medium text-ink-gray-7 mb-2">{{ __('No matches') }}</h3>
			<p class="text-sm text-ink-gray-5">{{ __('No pages or groups match "{0}"', [searchQuery]) }}</p>
		</div>

		<div v-else-if="!treeData.children || treeData.children.length === 0"
			class="flex flex-col items-center justify-center py-16 border border-dashed border-outline-gray-2 rounded-lg">
			<span class="lucide-file-text size-12 text-ink-gray-4 mb-4" aria-hidden="true" />
			<h3 class="text-lg-medium text-ink-gray-7 mb-2">{{ __('No pages yet') }}</h3>
			<template v-if="!readonly">
				<p class="text-sm text-ink-gray-5 mb-6">{{ __('Create your first page to get started') }}</p>
				<Button variant="solid" @click="openCreateDialog(rootNode, false)">
					<template #prefix>
						<span class="lucide-file-plus size-4" aria-hidden="true" />
					</template>
					{{ __('Create First Page') }}
				</Button>
			</template>
			<p v-else class="text-sm text-ink-gray-5">{{ __('No pages have synced from the repository yet') }}</p>
		</div>

		<div v-else>
			<WikiTree
				:items="treeForRender.children"
				:change-type-map="changeTypeMap"
				:parent-name="rootNode"
				:space-id="spaceId"
				:readonly="readonly"
				:search-active="isSearching"
				:expanded-override="expandedOverride"
				:score-map="scoreMap"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				:can-manage-tabs="canManageTabs"
				@create="openCreateDialog"
				@delete="openDeleteDialog"
				@rename="openRenameDialog"
				@external-link="openExternalLinkDialog"
				@edit-external-link="openEditExternalLinkDialog"
				@tab-settings="openTabSettingsDialog"
				@convert-to-tab="openConvertTabDialog"
				@drag-state-change="handleDragStateChange"
			/>
		</div>

		<Dialog v-model:open="showCreateDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ createDialogTitle }}
				</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<FormControl v-model="createTitle" :label="__('Title')" type="text"
						:placeholder="createPlaceholder" autofocus />
					<div>
						<FormControl :label="__('Route')" type="text" :model-value="createRoute"
							:placeholder="__('space/page-url')"
							@update:model-value="handleCreateRouteInput" />
						<ErrorMessage class="mt-1.5" :message="createRouteError" />
					</div>
					<div v-if="createIsTab">
						<label class="block text-xs text-ink-gray-5 mb-1.5">{{ __('Icon') }}</label>
						<IconPicker v-model="createTabIcon" inline />
					</div>
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

		<Dialog v-model:open="showTabSettingsDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Tab settings') }}
				</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<p class="text-sm text-ink-gray-6">
						{{ __('Tabs appear in the horizontal bar above the page tree. Only top-level groups can be tabs.') }}
					</p>
					<FormControl v-model="tabSettingsIsTab" type="checkbox" :label="__('Show as a tab')" />
					<div v-if="tabSettingsIsTab">
						<label class="block text-xs text-ink-gray-5 mb-1.5">{{ __('Icon') }}</label>
						<IconPicker v-model="tabSettingsIcon" inline />
					</div>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="isUpdatingTab" @click="saveTabSettings(close)">
						{{ __('Save') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model:open="showConvertTabDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Convert to tab') }}
				</h3>
			</template>
			<template #default>
				<p class="text-ink-gray-7">
					{{ __('Convert "{0}" into a tab?', [convertTabNode?.title || __('this group')]) }}
				</p>
				<p class="text-sm text-ink-gray-5 mt-2">
					{{ __('It will appear in the horizontal tab bar. You can change its icon and name afterwards.') }}
				</p>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="isUpdatingTab" @click="confirmConvertTab(close)">
						{{ __('Convert') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model:open="showDeleteDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Delete') }} "{{ deleteNode?.title }}"
				</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<p class="text-ink-gray-7">
						{{ __('Are you sure you want to delete this') }}
						{{ deleteNode?.is_group ? __('group') : __('page') }}?
					</p>
					<div v-if="deleteNode?.is_group && deleteChildCount > 0"
						class="bg-surface-orange-1 border border-outline-orange-2 rounded-lg p-4">
						<div class="flex items-start gap-3">
							<span class="lucide-alert-triangle size-5 text-ink-orange-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
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

		<Dialog v-model:open="showRenameDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ renameNode?.is_group ? __('Rename Group') : __('Change Title') }}
				</h3>
			</template>
			<template #default>
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

		<Dialog v-model:open="showExternalLinkDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Add External Link') }}
				</h3>
			</template>
			<template #default>
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

		<Dialog v-model:open="showEditExternalLinkDialog">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">
					{{ __('Edit External Link') }}
				</h3>
			</template>
			<template #default>
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
import { Dropdown, ErrorMessage, FormControl } from 'frappe-ui';
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue';
import IconPicker from './IconPicker.vue';
import SpaceIcon from './SpaceIcon.vue';
import WikiTree from './WikiTree.vue';

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
	// Mirrors the backend's can_manage_tabs gate (space write access).
	canManageTabs: { type: Boolean, default: false },
	// Base route of the space, the prefix for pages created at the space root.
	spaceRoute: { type: String, default: '' },
	// The space's root group, which is where a tab must be created. This is not
	// `rootNode`: while a tab is being browsed, `rootNode` is that tab, and
	// creating there would nest a tab.
	spaceRootNode: { type: String, default: '' },
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

const draftStore = useDraftWorkspaceStore();
// Same space-scoped key WikiTree reads, so useTreeDialogs' auto-expand of the
// parent group after a create is actually visible in the tree.
const expandedNodes = useStorage(
	computed(() => `wiki-tree-expanded-nodes-${props.spaceId || 'default'}`),
	{},
);

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
	createIsTab,
	createTabIcon,
	createRoute,
	createRouteError,
	handleCreateRouteInput,
	showTabSettingsDialog,
	tabSettingsNode,
	tabSettingsIsTab,
	tabSettingsIcon,
	isUpdatingTab,
	openTabSettingsDialog,
	saveTabSettings,
	showConvertTabDialog,
	convertTabNode,
	openConvertTabDialog,
	confirmConvertTab,
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
} = useTreeDialogs(
	toRef(props, 'spaceId'),
	expandedNodes,
	toRef(props, 'spaceRoute'),
	toRef(props, 'spaceRootNode'),
);

const addOptions = [
	{
		label: __('New Page'),
		icon: 'file-plus',
		onClick: () => openCreateDialog(props.rootNode, false),
	},
	{
		label: __('New Group'),
		icon: 'folder-plus',
		onClick: () => openCreateDialog(props.rootNode, true),
	},
	{
		label: __('External Link'),
		icon: 'link',
		onClick: () => openExternalLinkDialog(props.rootNode),
	},
];

// A tab restructures top-level navigation for the whole space, so it is
// editor-only (mirrors the backend's can_manage_tabs gate) and only offered at
// the space root, where a tab is allowed to live.
const addOptionsWithTab = computed(() => {
	if (!props.canManageTabs) return addOptions;
	return [
		...addOptions,
		{
			label: __('New Tab'),
			icon: 'columns',
			// Always parented to the space root, whichever tab is being browsed.
			onClick: () =>
				openCreateDialog(props.spaceRootNode || props.rootNode, true, true),
		},
	];
});

const createDialogTitle = computed(() => {
	if (createIsTab.value) return __('Create New Tab');
	return createIsGroup.value ? __('Create New Group') : __('Create New Page');
});

const createPlaceholder = computed(() => {
	if (createIsTab.value) return __('Enter tab name');
	return createIsGroup.value ? __('Enter group name') : __('Enter page title');
});

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
