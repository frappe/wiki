import type { Page } from '@playwright/test';

/**
 * Reads of the draft tree through `window.__draftStore`, the draft workspace
 * store. Specs go through these, so a change to the store's tree shape is
 * made here once.
 */

type TreeRecord = {
	docKey: string;
	title: string;
	parentKey: string | null;
	isDeleted: boolean;
};

export type TreeStoreWindow = Window & {
	__draftStore: {
		findNode(docKey: string): TreeRecord | null;
		children(parentKey: string | null): TreeRecord[];
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
		(window as unknown as TreeStoreWindow).__draftStore
			.children(null)
			.map((node) => node.docKey),
	);
}

export function keyByTitle(page: Page, title: string) {
	return page.evaluate((wanted) => {
		const store = (window as unknown as TreeStoreWindow).__draftStore;
		const find = (parentKey: string | null): string | null => {
			for (const node of store.children(parentKey)) {
				if (node.title === wanted) return node.docKey;
				const found = find(node.docKey);
				if (found) return found;
			}
			return null;
		};
		return find(null);
	}, title);
}
