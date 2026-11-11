import { computed, markRaw, ref } from 'vue';

import { toPublished } from './utils.js';

// A server tree node (snake_case, from get_cr_tree or get_wiki_tree) as a flat
// record. Order and children live in `childIds`, not on the record.
function toRecord(serverNode, parentKey) {
	return {
		docKey: serverNode.doc_key,
		documentName: serverNode.document_name ?? serverNode.name ?? null,
		title: serverNode.title || '',
		route: serverNode.route || '',
		parentKey,
		isGroup: !!serverNode.is_group,
		isTab: !!serverNode.is_tab,
		tabIcon: serverNode.tab_icon || null,
		isPublished: toPublished(serverNode.is_published),
		isExternalLink: !!serverNode.is_external_link,
		externalUrl: serverNode.external_url || null,
		isDeleted: !!serverNode.is_deleted,
	};
}

// Local tree state: one record per page in `nodesById`, and the ordered keys
// under each parent in `childIds`. No network, no queue, no persistence.
// `isPending` tells whether the log still holds an entry for a page.
export function createTreeModel({ isPending = () => false } = {}) {
	const rootKey = ref(null);
	const nodesById = ref({});
	const childIds = ref({});

	// The top level is filed under the root's key, or under '' before a tree
	// has loaded.
	function listKey(parentKey) {
		if (!parentKey || parentKey === rootKey.value) return rootKey.value ?? '';
		return parentKey;
	}

	function findNode(docKey) {
		return nodesById.value[docKey] ?? null;
	}

	// Null when the parent is unknown, so a caller can refuse the change.
	function childKeys(parentKey) {
		const key = listKey(parentKey);
		if (key !== (rootKey.value ?? '') && !nodesById.value[key]) return null;
		return childIds.value[key] ?? [];
	}

	function children(parentKey) {
		return (childKeys(parentKey) ?? []).map((key) => nodesById.value[key]);
	}

	// Every record under a parent, depth first, in tree order.
	function pages(parentKey = null) {
		return children(parentKey).flatMap((record) => [
			record,
			...pages(record.docKey),
		]);
	}

	// From the top-level ancestor down to the page. Null for a page outside the
	// tree.
	function trail(docKey) {
		const records = [];
		for (let r = findNode(docKey); r; r = findNode(r.parentKey)) {
			records.unshift(r);
		}
		const top = records[0]?.docKey;
		return top && childKeys(null).includes(top) ? records : null;
	}

	const byDocumentName = computed(
		() =>
			new Map(
				Object.values(nodesById.value)
					.filter((record) => record.documentName)
					.map((record) => [record.documentName, record]),
			),
	);

	function nodeByDocumentName(name) {
		return byDocumentName.value.get(name) ?? null;
	}

	// The first page that can be opened under a parent, depth first. Groups
	// hold no content, and a deleted page keeps its row but must not open.
	function firstPage(parentKey = null) {
		for (const record of children(parentKey)) {
			if (record.isDeleted) continue;
			if (!record.isGroup && record.documentName) return record.documentName;
			const found = record.isGroup && firstPage(record.docKey);
			if (found) return found;
		}
		return null;
	}

	// Pages a link can point at, in tree order, each with the titles of the
	// groups above it so same-titled pages can be told apart.
	function linkablePages(parentKey = null, folders = []) {
		return children(parentKey).flatMap((record) => {
			if (record.isDeleted || record.isExternalLink) return [];
			if (record.isGroup) {
				return linkablePages(record.docKey, [...folders, record.title]);
			}
			return [
				{
					key: record.docKey,
					title: record.title,
					trail: folders,
					isPublished: record.isPublished,
				},
			];
		});
	}

	function placeKey(docKey, parentKey, index) {
		const key = listKey(parentKey);
		const list = childIds.value[key] ?? [];
		const at = Math.max(0, Math.min(index ?? list.length, list.length));
		childIds.value[key] = [...list.slice(0, at), docKey, ...list.slice(at)];
	}

	function unplaceKey(docKey, parentKey) {
		const key = listKey(parentKey);
		const list = childIds.value[key];
		if (list) childIds.value[key] = list.filter((k) => k !== docKey);
	}

	function insertNode(record, parentKey) {
		if (!childKeys(parentKey)) return;
		nodesById.value[record.docKey] = { ...record, parentKey };
		placeKey(record.docKey, parentKey);
	}

	// Writes a page's own fields. A page the tree has not loaded yet gets a
	// record with no parent, in no child list, so only `findNode` sees it.
	function setFields(docKey, fields) {
		nodesById.value[docKey] ??= toRecord({ doc_key: docKey }, null);
		Object.assign(nodesById.value[docKey], fields);
	}

	function moveNode(docKey, parentKey, index) {
		const record = findNode(docKey);
		if (!record || !childKeys(parentKey)) return;
		unplaceKey(docKey, record.parentKey);
		placeKey(docKey, parentKey, index);
		record.parentKey = parentKey;
	}

	function subtreeKeys(docKey) {
		const keys = [docKey];
		for (let i = 0; i < keys.length; i++) {
			keys.push(...(childIds.value[keys[i]] ?? []));
		}
		return keys;
	}

	// Delete and restore cascade over the subtree server-side, so the local
	// flags have to move together with them.
	function setSubtreeDeleted(docKey, isDeleted) {
		if (!findNode(docKey)) return;
		for (const key of subtreeKeys(docKey)) {
			const record = nodesById.value[key];
			if (record) record.isDeleted = isDeleted;
		}
	}

	function applyServerTree(serverTree) {
		// get_wiki_tree's `root_group` is the root's document name, so its
		// `root_key` wins.
		const root = serverTree?.root_key || serverTree?.root_group || null;
		const records = {};
		const lists = {};
		const visit = (nodes, parentKey) => {
			lists[parentKey ?? ''] = nodes.map((node) => node.doc_key);
			for (const node of nodes) {
				records[node.doc_key] = toRecord(node, parentKey);
				if (node.children?.length) visit(node.children, node.doc_key);
			}
		};
		visit(serverTree?.children || [], root);
		rootKey.value = root;
		nodesById.value = records;
		childIds.value = lists;
	}

	function reset() {
		rootKey.value = null;
		nodesById.value = {};
		childIds.value = {};
	}

	// Raw, so a store that exposes the model leaves its refs as refs.
	return markRaw({
		rootKey,
		nodesById,
		childIds,
		isPending,
		findNode,
		childKeys,
		children,
		pages,
		trail,
		nodeByDocumentName,
		firstPage,
		linkablePages,
		insertNode,
		setFields,
		moveNode,
		setSubtreeDeleted,
		applyServerTree,
		reset,
	});
}
