<template>
	<Tree
		class="wiki-tree"
		:nodes="treeNodes"
		node-key="doc_key"
		guides="none"
		:draggable="!readonly && !searchActive"
		:move="allowMove"
		@drag-start="onDragStart"
		@drag-end="onDragEnd"
	>
		<template #item="{ node }">
			<div
				class="group flex min-w-0 flex-1 items-center gap-1.5 py-1.5"
				:class="getRowClasses(node)"
				:data-selected="isSelected(node) || undefined"
				@click.stop="handleRowClick(node)"
			>
				<button
					v-if="node.is_group"
					class="p-0.5 hover:bg-surface-gray-3 rounded shrink-0"
					:aria-label="isNodeExpanded(node.doc_key) ? __('Collapse') : __('Expand')"
					@click.stop="toggleExpanded(node.doc_key)"
				>
					<span
						class="lucide-chevron-right size-4 text-ink-gray-5 transition-transform duration-200 block"
						:class="{ 'rotate-90': isNodeExpanded(node.doc_key) }"
						aria-hidden="true"
					/>
				</button>

				<SpaceIcon v-if="node.is_tab" :icon="node.tab_icon" class="text-ink-gray-5 shrink-0" />
				<span v-else-if="node.is_group" class="lucide-folder size-4 text-ink-gray-5 shrink-0" aria-hidden="true" />
				<span v-else-if="node.is_external_link" class="lucide-link size-4 text-ink-gray-5 shrink-0" aria-hidden="true" />
				<span v-else class="lucide-file-text size-4 text-ink-gray-5 shrink-0" aria-hidden="true" />

				<div class="flex min-w-0 flex-1 flex-col">
					<span class="text-sm truncate" :class="getTitleClass(node)">
						<template v-for="(seg, i) in titleParts(node)" :key="i"><mark v-if="seg.matched" class="bg-surface-amber-2 text-ink-gray-9 rounded-sm">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
					</span>
					<!-- Why it matched, when the route hit but the title didn't. -->
					<span v-if="routeParts(node)" class="text-xs text-ink-gray-4 truncate">
						<template v-for="(seg, i) in routeParts(node)" :key="i"><mark v-if="seg.matched" class="bg-surface-amber-2 text-ink-gray-9 rounded-sm">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
					</span>
				</div>

				<Badge v-if="node.local_status === 'sync_failed'" variant="subtle" theme="red" size="sm" :title="__('Sync failed — edit again or delete to recover')">
					{{ __('Sync failed') }}
				</Badge>
				<Badge v-else-if="node.local_status === 'pending_create' || node.local_status === 'pending_update'" variant="subtle" theme="gray" size="sm" :title="__('Saving…')">
					{{ __('Syncing…') }}
				</Badge>
				<Badge v-else-if="changeTypeMap.get(node.doc_key) === 'added'" variant="subtle" theme="blue" size="sm">
					{{ __('New') }}
				</Badge>
				<Badge v-else-if="changeTypeMap.get(node.doc_key) === 'deleted'" variant="subtle" theme="red" size="sm">
					{{ __('Deleted') }}
				</Badge>
				<Badge v-else-if="changeTypeMap.get(node.doc_key) === 'modified'" variant="subtle" theme="blue" size="sm">
					{{ __('Modified') }}
				</Badge>
				<Badge v-else-if="changeTypeMap.get(node.doc_key) === 'reordered'" variant="subtle" theme="orange" size="sm">
					{{ __('Reordered') }}
				</Badge>
				<Badge v-else-if="!node.is_group && !node.is_published" variant="subtle" theme="orange" size="sm">
					{{ __('Not Published') }}
				</Badge>

				<!-- Hover-reveal on desktop; always visible on touch (no hover)
				     so row actions stay reachable on a phone. -->
				<div v-if="!readonly" class="flex items-center opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity" @click.stop>
					<Dropdown :options="getDropdownOptions(node)">
						<Button variant="ghost" size="sm">
							<span class="lucide-more-horizontal size-4" aria-hidden="true" />
						</Button>
					</Dropdown>
				</div>
			</div>
		</template>
	</Tree>
</template>

<script setup>
import { highlightSegments } from '@/composables/useTreeSearch';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import SpaceIcon from './SpaceIcon.vue';
import { useStorage } from '@vueuse/core';
import { Badge, Button, Dropdown, Tree, toast } from 'frappe-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps({
	items: {
		type: Array,
		required: true,
	},
	changeTypeMap: {
		type: Map,
		default: () => new Map(),
	},
	parentName: {
		type: String,
		default: null,
	},
	spaceId: {
		type: String,
		default: null,
	},
	// Read-only spaces (git-synced) render the tree for browsing only: no
	// drag-reorder, no row actions, no add-page/group affordances.
	readonly: {
		type: Boolean,
		default: false,
	},
	// While a tree search is active we render a pruned tree with drag disabled
	// and every ancestor-of-a-match force-expanded.
	searchActive: {
		type: Boolean,
		default: false,
	},
	expandedOverride: {
		type: Object, // Set<doc_key> | null
		default: null,
	},
	scoreMap: {
		type: Object, // Map<doc_key, fuzzysort result> | null
		default: null,
	},
	selectedPageId: {
		type: String,
		default: null,
	},
	selectedDraftKey: {
		type: String,
		default: null,
	},
	canManageTabs: { type: Boolean, default: false },
});

const emit = defineEmits([
	'create',
	'delete',
	'rename',
	'external-link',
	'edit-external-link',
	'tab-settings',
	'convert-to-tab',
	'drag-state-change',
]);

const router = useRouter();
const route = useRoute();
const draftStore = useDraftWorkspaceStore();

const storageKey = computed(
	() => `wiki-tree-expanded-nodes-${props.spaceId || 'default'}`,
);
const expandedNodes = useStorage(storageKey, {});

function isNodeExpanded(name) {
	// During search, force-open ancestors of matches without touching the
	// user's saved expand state — clearing the query restores their tree.
	if (props.expandedOverride) {
		return props.expandedOverride.has(name);
	}
	return expandedNodes.value[name] === true;
}

function toggleExpanded(name) {
	// While searching, groups are force-expanded via expandedOverride; writing
	// to expandedNodes here would silently corrupt the user's saved layout
	// (no visible change now, but restore-on-clear would show it). So no-op.
	if (props.searchActive) return;
	expandedNodes.value[name] = !expandedNodes.value[name];
}

// Tree reads/writes each node's `expanded` field and mutates node order is
// left to us via @drag-end, so we hand it a derived copy of the store tree:
// `label` feeds the drag ghost + keyboard typeahead, `expanded` is resolved
// from the persisted map (or the search override). Held in a ref so the
// copies are reactive and Tree's own keyboard toggles still render.
const treeNodes = ref([]);

function mapNodes(nodes) {
	return (nodes || []).map((node) => ({
		...node,
		label: node.title,
		expanded: isNodeExpanded(node.doc_key),
		children: node.children?.length ? mapNodes(node.children) : undefined,
	}));
}

watch(
	[() => props.items, () => props.expandedOverride, expandedNodes],
	() => {
		treeNodes.value = mapNodes(props.items);
	},
	{ immediate: true, deep: true },
);

// Selecting a page from the sidebar shouldn't pile up history, and the bare
// space landing ("select a page") shouldn't become a back target. When we are
// already inside this space, replace instead of push so browser-back returns
// to wherever the user entered the space from rather than ping-ponging
// between pages and the landing.
function navigateToTreePage(to) {
	if (route.params.spaceId === props.spaceId) {
		router.replace(to);
	} else {
		router.push(to);
	}
}

function handleRowClick(node) {
	if (props.changeTypeMap.get(node.doc_key) === 'deleted') {
		return;
	}

	if (node.is_group) {
		toggleExpanded(node.doc_key);
		return;
	}

	// External links open edit dialog instead of navigating
	if (node.is_external_link) {
		emit('edit-external-link', node);
		return;
	}

	if (node.document_name) {
		navigateToTreePage({
			name: 'SpacePage',
			params: { spaceId: props.spaceId, pageId: node.document_name },
		});
		return;
	}

	navigateToTreePage({
		name: 'DraftChangeRequest',
		params: { spaceId: props.spaceId, docKey: node.doc_key },
	});
}

function isSelected(node) {
	const isSelectedPage =
		!node.is_group &&
		!!props.selectedPageId &&
		node.document_name === props.selectedPageId;
	const isSelectedDraft =
		!node.document_name &&
		!!props.selectedDraftKey &&
		node.doc_key === props.selectedDraftKey;
	return isSelectedPage || isSelectedDraft;
}

function getRowClasses(node) {
	if (props.changeTypeMap.get(node.doc_key) === 'deleted') {
		return 'cursor-not-allowed opacity-60';
	}
	return 'cursor-pointer';
}

function getTitleClass(node) {
	if (props.changeTypeMap.get(node.doc_key) === 'deleted') {
		return 'text-ink-gray-4 line-through';
	}
	if (node.is_published || node.is_group) {
		return 'text-ink-gray-8';
	}
	return 'text-ink-gray-5';
}

// fuzzysort multi-key result is array-like: [0] = title key, [1] = route key.
// Render as escaped { text, matched } segments (never an HTML string) — see
// highlightSegments. titleParts always returns an array (plain title when no
// match); routeParts only when the route matched but the title didn't.
function titleParts(node) {
	const result = props.scoreMap?.get(node.doc_key)?.[0];
	return highlightSegments(result) || [{ text: node.title, matched: false }];
}

function routeParts(node) {
	if (highlightSegments(props.scoreMap?.get(node.doc_key)?.[0])) return null;
	return highlightSegments(props.scoreMap?.get(node.doc_key)?.[1]);
}

// Reparenting is only allowed into groups; sibling reorder is always fine.
// Tree's built-in guards (drop-on-self, drop-into-own-descendant) run first.
//
// A tab must stay top-level, so it can't be dropped inside anything, and it can
// only sit beside other top-level rows. `parentName` is the tab's own parent
// while that tab is the active subtree root, hence the depth check on target.
// The server guards this too (_move_cr_item / reorder_wiki_documents); this
// only stops the drag from looking like it worked.
function allowMove({ dragNode, target, position }) {
	if (dragNode?.is_tab) {
		if (position === 'inside') return false;
		return isTopLevel(target);
	}
	return position !== 'inside' || !!target.is_group;
}

function isTopLevel(node) {
	return props.items.some((item) => item.doc_key === node?.doc_key);
}

function onDragStart() {
	emit('drag-state-change', true);
}

function onDragEnd(info) {
	emit('drag-state-change', false);
	if (!info) return;

	// Push the move into the workspace store synchronously so the tree
	// rebuilds with the new order. The store also debounces the backend
	// sync, so rapid drags coalesce into one roundtrip.
	draftStore.moveNode({
		docKey: info.node.doc_key,
		newParentKey: info.to || props.parentName || null,
		newIndex: info.newIndex,
	});
}

async function togglePublish(node) {
	const newStatus = node.is_published ? 0 : 1;
	try {
		await draftStore.updateNode(node.doc_key, { is_published: newStatus });
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating publish status'));
	}
}

function getDropdownOptions(node) {
	const options = [];

	if (node.is_group) {
		options.push(
			...[
				{
					label: __('New Page'),
					icon: 'file-plus',
					onClick: () => emit('create', node.doc_key, false),
				},
				{
					label: __('New Group'),
					icon: 'folder-plus',
					onClick: () => emit('create', node.doc_key, true),
				},
				{
					label: __('External Link'),
					icon: 'link',
					onClick: () => emit('external-link', node.doc_key),
				},
				{
					label: __('Rename'),
					icon: 'edit-2',
					onClick: () => emit('rename', node),
				},
			],
		);

		// Only top-level groups can be tabs, so don't offer an action the
		// backend would reject. Editor-only, mirroring can_manage_tabs.
		if (props.canManageTabs && isTopLevel(node)) {
			options.push({
				label: node.is_tab ? __('Tab settings') : __('Convert to tab'),
				icon: 'columns',
				onClick: () =>
					emit(node.is_tab ? 'tab-settings' : 'convert-to-tab', node),
			});
		}
	}

	if (!node.is_group) {
		options.push({
			label: __('Change Title'),
			icon: 'edit-2',
			onClick: () => emit('rename', node),
		});
		options.push({
			label: node.is_published ? __('Unpublish') : __('Publish'),
			icon: node.is_published ? 'eye-off' : 'eye',
			onClick: () => togglePublish(node),
		});
	}

	const hasChildren = node.is_group && node.children?.length > 0;
	if (!hasChildren) {
		options.push({
			group: __('Danger'),
			options: [
				{
					label: __('Delete'),
					icon: 'trash-2',
					theme: 'red',
					onClick: () => emit('delete', node),
				},
			],
		});
	}

	return options;
}

onBeforeUnmount(() => {
	emit('drag-state-change', false);
});
</script>

<!-- Unscoped: Tree renders a multi-root template, so the parent scope id never
     reaches its <ul> and scoped selectors can't match. .wiki-tree namespaces. -->
<style>
.wiki-tree {
	/* Rows carry two-line search results and py-1.5 content — size to content
	   instead of the Tree default 32px. */
	--tree-row-height: auto;
	/* One level of indent equals a group's chevron column (w-5 button + gap-1.5
	   = 20px + 6px). Leaves omit that chevron placeholder, so this makes a nested
	   page's icon line up under its parent folder's icon instead of sitting left
	   of it. */
	--tree-indent: 26px;
}

/* Selected page/draft highlight lives on the full-width row (the #item slot
   can't reach its parent), keyed off the data-selected marker inside it. */
.wiki-tree [data-slot='row']:has([data-selected]) {
	background-color: var(--surface-gray-3);
}
</style>
