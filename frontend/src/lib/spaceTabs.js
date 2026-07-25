// Shared helpers for horizontal tab navigation.
//
// Tabs are derived from the *tree the sidebar is already rendering*, not from a
// separate API call. In the editor that tree is the draft/change-request tree,
// so a tab created in an unmerged draft shows up in the bar immediately. The
// public reader has its own (live) source — see get_space_tabs.

// Bar entry for the space's non-tab top-level content. Only offered when such
// content exists, so a fully tabbed space never shows it.
export const GENERAL_KEY = '__general__';

/**
 * Build the tab bar's entries from a tree's top-level nodes.
 * Returns [{ key, title, icon, node }]; `node` is null for the Home entry.
 * `homeLabel` / `homeIcon` come from the space's home_tab_title / home_tab_icon.
 */
export function buildTabList(topLevelNodes, homeLabel, homeIcon) {
	const nodes = topLevelNodes || [];
	const tabs = nodes
		.filter((node) => node.is_tab)
		.map((node) => ({
			key: node.doc_key,
			title: node.title,
			icon: node.tab_icon || null,
			node,
		}));

	// Home always leads the bar in the editor: it's the space's landing
	// (everything not filed under a tab) and the anchor new tabs append to its
	// right of. Shown even with no tabs yet, so the "+ New Tab" affordance and the
	// tab model are always discoverable.
	tabs.unshift({
		key: GENERAL_KEY,
		title: homeLabel,
		// 'lucide-house' literal so Tailwind's JIT emits the fallback class.
		icon: homeIcon || 'lucide-house',
		node: null,
	});
	return tabs;
}

/**
 * Which tab owns a given node — the active-tab rule from the spec: walk the
 * current page's ancestors up to the tab-flagged group.
 *
 * `matches(node)` identifies the selected node; returns the owning tab's key,
 * GENERAL_KEY when the node lives outside every tab, or null when not found.
 */
export function findOwningTabKey(topLevelNodes, matches) {
	for (const top of topLevelNodes || []) {
		if (containsNode(top, matches)) {
			return top.is_tab ? top.doc_key : GENERAL_KEY;
		}
	}
	return null;
}

function containsNode(node, matches) {
	if (matches(node)) return true;
	return (node.children || []).some((child) => containsNode(child, matches));
}

/**
 * The subtree the vertical sidebar should render for the active tab, plus the
 * doc_key that top-level drops inside it should reparent to.
 */
export function subtreeForTab(topLevelNodes, activeKey, rootGroup) {
	const nodes = topLevelNodes || [];
	if (!activeKey || activeKey === GENERAL_KEY) {
		return {
			children: nodes.filter((node) => !node.is_tab),
			rootNode: rootGroup,
		};
	}
	const tab = nodes.find((node) => node.doc_key === activeKey);
	if (!tab) return { children: nodes, rootNode: rootGroup };
	return { children: tab.children || [], rootNode: tab.doc_key };
}
