import { computed, ref, watch } from 'vue';

import {
	buildTabList,
	findOwningTabKey,
	subtreeForTab,
} from '../lib/spaceTabs.js';

/**
 * Horizontal tab state for a space.
 *
 * Lives above both the tab bar (rendered in the main column header) and the
 * sidebar tree it filters, so the two can't disagree about which tab is active.
 *
 * Tabs are derived from the tree the sidebar is already rendering rather than
 * from get_space_tabs: in the editor that's the draft/change-request tree, so a
 * tab created in an unmerged draft shows up immediately.
 */
export function useSpaceTabs(
	treeData,
	selectedPageId,
	selectedDraftKey,
	homeMeta,
) {
	const topLevelNodes = computed(() => treeData.value?.children || []);
	const tabs = computed(() =>
		buildTabList(
			topLevelNodes.value,
			homeMeta?.value?.title || __('Home'),
			homeMeta?.value?.icon,
		),
	);

	// The tab owning the currently open page: walk the page's ancestors up to
	// the tab-flagged group.
	const selectedTabKey = computed(() => {
		if (!tabs.value.length) return null;
		if (!selectedPageId.value && !selectedDraftKey.value) return null;
		return findOwningTabKey(
			topLevelNodes.value,
			(node) =>
				(selectedDraftKey.value && node.doc_key === selectedDraftKey.value) ||
				(selectedPageId.value && node.document_name === selectedPageId.value),
		);
	});

	// A single ref rather than a computed, so the most recent action wins:
	// clicking a tab browses it even while a page from another tab is open, and
	// navigating to a page pulls the bar back to that page's tab.
	const activeTabKey = ref(null);

	watch(
		[tabs, selectedTabKey],
		([tabList, owningKey]) => {
			if (!tabList.length) {
				activeTabKey.value = null;
				return;
			}
			const stillValid = tabList.some((tab) => tab.key === activeTabKey.value);
			if (owningKey) activeTabKey.value = owningKey;
			else if (!stillValid) activeTabKey.value = tabList[0].key;
		},
		{ immediate: true, deep: true },
	);

	// The active tab becomes the tree's root, so top-level drops reparent into
	// the tab rather than the space root.
	const visibleTreeData = computed(() => {
		if (!treeData.value) return { children: [], root_group: '' };
		if (!tabs.value.length) return treeData.value;

		const { children, rootNode } = subtreeForTab(
			topLevelNodes.value,
			activeTabKey.value,
			treeData.value.root_group || '',
		);
		return { ...treeData.value, children, root_group: rootNode };
	});

	function selectTab(key) {
		activeTabKey.value = key;
	}

	return { tabs, activeTabKey, selectTab, visibleTreeData };
}
