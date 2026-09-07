<template>
	<div class="flex h-full min-h-0 flex-col">
		<!-- Search sits above the scroller, so it stays put while results move. -->
		<div v-if="hasPages" class="shrink-0 px-2 pb-2">
			<TextInput
				v-model="searchQuery"
				class="w-full"
				size="sm"
				type="text"
				:placeholder="__('Search pages...')"
				@keydown.esc="searchQuery = ''"
			>
				<template #prefix>
					<span class="lucide-search size-4 text-ink-gray-4" aria-hidden="true" />
				</template>
				<template v-if="searchQuery" #suffix>
					<button class="flex" :title="__('Clear search')" @click="searchQuery = ''">
						<span class="lucide-x size-4 text-ink-gray-5 hover:text-ink-gray-7" aria-hidden="true" />
					</button>
				</template>
			</TextInput>
		</div>

		<ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pb-2">
			<p
				v-if="isSearching && !hasResults"
				class="px-1.5 py-3 text-sm text-ink-gray-5"
			>
				{{ __('No pages match "{0}"', [searchQuery]) }}
			</p>

			<div
				v-else-if="!hasPages"
				class="flex flex-col items-center justify-center px-2 py-10 text-center"
			>
				<span class="lucide-file-text size-8 text-ink-gray-4 mb-3" aria-hidden="true" />
				<h3 class="text-base-medium text-ink-gray-7 mb-1">{{ __('No pages yet') }}</h3>
				<p class="text-sm text-ink-gray-5">
					{{ readonly
						? __('No pages have synced from the repository yet')
						: __('Create your first page to get started') }}
				</p>
			</div>

			<!-- Searching swaps the tree for the ranked flat list; the rows are
			     the same component, so selection, badges and row actions hold. -->
			<WikiTree
				v-else
				:items="isSearching ? matches : treeData.children"
				:change-type-map="changeTypeMap"
				:parent-name="rootNode"
				:space-id="spaceId"
				:readonly="readonly"
				:search-active="isSearching"
				:score-map="scoreMap"
				:selected-page-id="selectedPageId"
				:selected-draft-key="selectedDraftKey"
				@create="openCreateDialog"
				@delete="openDeleteDialog"
				@rename="openRenameDialog"
				@external-link="openExternalLinkDialog"
				@edit-external-link="openEditExternalLinkDialog"
				@reveal-group="revealGroup"
				@drag-state-change="handleDragStateChange"
			/>
		</ScrollArea>

		<!-- New page is the one thing this column is asked for constantly, so it
		     gets a fixed footer; the rarer kinds live behind the overflow menu.
		     A chevron would read as "more of the same button"; these are other
		     kinds of thing, so it takes the three-dot mark every other overflow
		     menu in the app uses. -->
		<div
			v-if="!readonly"
			class="flex shrink-0 items-center gap-1.5 border-t border-outline-gray-2 p-2"
		>
			<Button class="flex-1" variant="subtle" :label="__('New page')" @click="openCreateDialog(rootNode, false)">
				<template #prefix>
					<span class="lucide-plus size-4" aria-hidden="true" />
				</template>
			</Button>
			<Dropdown :options="addOptions" placement="right">
				<Button variant="subtle" :title="__('Add a group or link')">
					<template #icon>
						<span class="lucide-more-horizontal size-4" aria-hidden="true" />
					</template>
				</Button>
			</Dropdown>
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
						class="bg-surface-orange-1 border border-outline-orange-2 rounded-6 p-4">
						<div class="flex items-start gap-3">
							<span class="lucide-alert-triangle size-5 text-ink-orange-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
							<div>
								<p class="font-medium text-ink-orange-3">{{ __('Warning') }}</p>
								<p class="text-sm text-ink-orange-2 mt-1">
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
import { useNewPageRequest } from '@/composables/useNewPageRequest';
import { useTreeDialogs } from '@/composables/useTreeDialogs';
import { useTreeSearch } from '@/composables/useTreeSearch';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { useStorage } from '@vueuse/core';
import {
	Dropdown,
	ErrorMessage,
	FormControl,
	ScrollArea,
	TextInput,
} from 'frappe-ui';
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue';
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
	// Base route of the space, the prefix for pages created at the space root.
	spaceRoute: { type: String, default: '' },
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

const hasPages = computed(() => (props.treeData?.children?.length || 0) > 0);

// Client-side fuzzy filter over the in-memory tree (title + route). Results
// render as a flat ranked list, not a pruned tree.
const {
	query: searchQuery,
	isSearching,
	matches,
	hasResults,
	scoreMap,
} = useTreeSearch(toRef(props, 'treeData'));

// A group in the result list has no children to open in place, so picking one
// drops the search and opens it where it actually lives.
function revealGroup(node) {
	expandedNodes.value[node.doc_key] = true;
	searchQuery.value = '';
}

const {
	showCreateDialog,
	createTitle,
	createIsGroup,
	createRoute,
	createRouteError,
	handleCreateRouteInput,
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
	toRef(props, 'rootNode'),
);

// The empty content column offers "New page" too, but the dialog that makes one
// lives here, with the route-computation it needs. Immediate, so a request made
// while this tree was still unmounted (the mobile drawer) is picked up on mount.
// A read-only tree consumes nothing: nothing should reach around the gate on
// the footer.
const { pending: newPageRequested, consumeNewPageRequest } =
	useNewPageRequest();
watch(
	newPageRequested,
	(requested) => {
		if (!requested || props.readonly) return;
		if (consumeNewPageRequest()) openCreateDialog(props.rootNode, false);
	},
	{ immediate: true },
);

// New Page is the footer's own button, so it is not repeated here.
const addOptions = [
	{
		label: __('New Group'),
		icon: 'lucide-folder-plus',
		onClick: () => openCreateDialog(props.rootNode, true),
	},
	{
		label: __('External Link'),
		icon: 'lucide-link',
		onClick: () => openExternalLinkDialog(props.rootNode),
	},
];

const createDialogTitle = computed(() =>
	createIsGroup.value ? __('Create New Group') : __('Create New Page'),
);

const createPlaceholder = computed(() =>
	createIsGroup.value ? __('Enter group name') : __('Enter page title'),
);

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
