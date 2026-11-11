import type { Page } from '@playwright/test';

/**
 * Reads of the draft tree through `window.__draftStore`, the draft workspace
 * store. Specs go through these, so a change to the store's tree shape is
 * made here once.
 */

type LegacyNode = { doc_key: string; title: string; children: LegacyNode[] };

export type TreeStoreWindow = Window & {
	__draftStore: {
		findNode(docKey: string): {
			title: string;
			parentKey: string | null;
			isDeleted: boolean;
		} | null;
		treeAsLegacy: { children: LegacyNode[] };
	};
};

export function localNode(page: Page, docKey: string) {
	return page.evaluate((key) => {
		const node = (window as unknown as TreeStoreWindow).__draftStore.findNode(
			key,
		);
		if (!node) return null;
		return {
			title: node.title,
			parentKey: node.parentKey,
			isDeleted: node.isDeleted,
		};
	}, docKey);
}

export function topLevelKeys(page: Page) {
	return page.evaluate(() =>
		(
			window as unknown as TreeStoreWindow
		).__draftStore.treeAsLegacy.children.map((node) => node.doc_key),
	);
}

export function keyByTitle(page: Page, title: string) {
	return page.evaluate((wanted) => {
		const find = (nodes: LegacyNode[]): string | null => {
			for (const node of nodes) {
				if (node.title === wanted) return node.doc_key;
				const found = find(node.children);
				if (found) return found;
			}
			return null;
		};
		return find(
			(window as unknown as TreeStoreWindow).__draftStore.treeAsLegacy.children,
		);
	}, title);
}
