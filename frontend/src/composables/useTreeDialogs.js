import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { slugify } from '@/stores/draftWorkspace/utils';
import { useDebounceFn } from '@vueuse/core';
import { createResource, toast } from 'frappe-ui';
import { ref, unref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { DEFAULT_TAB_ICON } from '../lib/tabIcons.js';

const CHECK_ROUTE_AVAILABLE =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.check_route_available';

export function useTreeDialogs(
	spaceId,
	expandedNodes,
	spaceRoute,
	spaceRootNode,
) {
	const draftStore = useDraftWorkspaceStore();
	const router = useRouter();

	const showCreateDialog = ref(false);
	const createTitle = ref('');
	const createParent = ref(null);
	const createIsGroup = ref(false);
	const createIsTab = ref(false);
	const createTabIcon = ref('');
	const createRoute = ref('');
	const createRoutePrefix = ref('');
	const createRouteError = ref('');
	const routeManuallyEdited = ref(false);

	const showTabSettingsDialog = ref(false);
	const tabSettingsNode = ref(null);
	const tabSettingsIsTab = ref(false);
	const tabSettingsIcon = ref('');
	const isUpdatingTab = ref(false);

	const showConvertTabDialog = ref(false);
	const convertTabNode = ref(null);

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

	const isCreating = ref(false);
	const isRenaming = ref(false);
	const isDeleting = ref(false);
	const isUpdatingExternalLink = ref(false);

	// A group's route already carries the space route plus every ancestor slug,
	// so a child's prefix is simply the parent's URL. Only the space root is
	// special: its own route is a bare slug, and the space route stands in.
	function routePrefixFor(parentKey) {
		const base = unref(spaceRoute) || '';
		const rootKey = unref(spaceRootNode) || draftStore.rootKey;
		if (!parentKey || parentKey === rootKey) return base;
		return draftStore.findNode(parentKey)?.route || base;
	}

	function derivedRoute() {
		return [createRoutePrefix.value, slugify(createTitle.value)]
			.filter(Boolean)
			.join('/');
	}

	const checkRouteResource = createResource({ url: CHECK_ROUTE_AVAILABLE });
	// Replies can land out of order, and two checks of the same route text can
	// legitimately disagree (a page claiming it may have been created in
	// between), so only the newest request is allowed to write the result.
	let latestRouteCheck = 0;

	const checkRouteAvailability = useDebounceFn(async () => {
		const check = ++latestRouteCheck;
		const route = createRoute.value.trim();
		// Groups deliberately share a route with their landing page, so the
		// uniqueness rule (and this check) only applies to leaves.
		if (!route || createIsGroup.value) {
			createRouteError.value = '';
			return;
		}
		try {
			const result = await checkRouteResource.submit({
				wiki_space: unref(spaceId),
				route,
				cr_name: draftStore.crName || null,
			});
			if (check !== latestRouteCheck) return;
			createRouteError.value = result?.available
				? ''
				: __('This route is already in use');
		} catch (error) {
			// A failed check must not block creation; the backend still
			// rejects a genuine duplicate at merge time.
			console.error('Error checking route:', error);
			if (check !== latestRouteCheck) return;
			createRouteError.value = '';
		}
	}, 300);

	watch(createTitle, () => {
		if (routeManuallyEdited.value) return;
		createRoute.value = derivedRoute();
		checkRouteAvailability();
	});

	function handleCreateRouteInput(value) {
		if (value !== derivedRoute()) routeManuallyEdited.value = true;
		createRoute.value = value;
		createRouteError.value = '';
		checkRouteAvailability();
	}

	function openCreateDialog(parentKey, isGroup, isTab = false) {
		createParent.value = parentKey;
		// A tab is always a group; the backend rejects anything else.
		createIsGroup.value = isGroup || isTab;
		createIsTab.value = isTab;
		createTitle.value = '';
		createTabIcon.value = '';
		createRoutePrefix.value = routePrefixFor(parentKey);
		createRoute.value = '';
		createRouteError.value = '';
		// Retire any check still in flight from the previous dialog.
		latestRouteCheck++;
		routeManuallyEdited.value = false;
		showCreateDialog.value = true;
	}

	function openTabSettingsDialog(node) {
		tabSettingsNode.value = node;
		tabSettingsIsTab.value = !!node?.is_tab;
		tabSettingsIcon.value = node?.tab_icon || '';
		showTabSettingsDialog.value = true;
	}

	function openConvertTabDialog(node) {
		convertTabNode.value = node;
		showConvertTabDialog.value = true;
	}

	// Convert straight to a tab with a sensible default icon — the user tweaks
	// the icon inline afterwards rather than being prompted mid-flow.
	async function confirmConvertTab(close) {
		const docKey = convertTabNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isUpdatingTab.value = true;
		try {
			await draftStore.updateNode(docKey, {
				is_tab: 1,
				tab_icon: DEFAULT_TAB_ICON,
			});
		} catch (error) {
			console.error('Error converting to tab:', error);
			toast.error(error.messages?.[0] || __('Error converting to tab'));
		} finally {
			isUpdatingTab.value = false;
		}
	}

	// Promote/demote an existing top-level group. Clearing the flag leaves
	// tab_icon alone so a demote/promote round trip keeps the icon.
	async function saveTabSettings(close) {
		const docKey = tabSettingsNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		const fields = { is_tab: tabSettingsIsTab.value ? 1 : 0 };
		if (tabSettingsIsTab.value) fields.tab_icon = tabSettingsIcon.value || null;
		close();
		isUpdatingTab.value = true;
		try {
			await draftStore.updateNode(docKey, fields);
		} catch (error) {
			console.error('Error updating tab:', error);
			toast.error(error.messages?.[0] || __('Error updating tab'));
		} finally {
			isUpdatingTab.value = false;
		}
	}

	function countDescendants(node) {
		if (!node?.children?.length) return 0;
		return node.children.reduce(
			(sum, child) => sum + 1 + countDescendants(child),
			0,
		);
	}

	function openDeleteDialog(node) {
		deleteNode.value = node;
		deleteChildCount.value = node?.is_group ? countDescendants(node) : 0;
		showDeleteDialog.value = true;
	}

	// Local-first create: store inserts a temp node into the tree immediately,
	// the dialog closes right away, and the backend call runs in the
	// background. Failure is surfaced through the store's mutation queue.
	async function createDocument(close) {
		const title = createTitle.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}
		if (createRouteError.value) {
			toast.warning(createRouteError.value);
			return;
		}

		const parentKey = createParent.value;
		const isGroup = createIsGroup.value;
		const isTab = createIsTab.value;
		const tabIcon = createTabIcon.value || null;
		const route = createRoute.value.trim() || derivedRoute();

		if (parentKey) expandedNodes.value[parentKey] = true;
		close();

		isCreating.value = true;
		try {
			const { tempKey, promise } = draftStore.createNode({
				parentKey,
				title,
				isGroup,
				isTab,
				tabIcon,
				route,
			});
			// Open the new page for editing immediately. The DraftContributionPanel
			// reads its content from pagesByKey (seeded by createNode), and the
			// route remaps from tmp_* to the real key once the create syncs.
			// Groups have no editable content, so skip navigation for those.
			if (!isGroup && spaceId.value) {
				router.push({
					name: 'DraftChangeRequest',
					params: { spaceId: spaceId.value, docKey: tempKey },
				});
			}
			await promise;
		} catch (error) {
			console.error('Error creating page:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isCreating.value = false;
		}
	}

	async function deleteDocument(close) {
		const docKey = deleteNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isDeleting.value = true;
		try {
			await draftStore.deleteNode(docKey);
		} catch (error) {
			console.error('Error creating delete draft:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isDeleting.value = false;
		}
	}

	function openRenameDialog(node) {
		renameNode.value = node;
		renameTitle.value = node.title || '';
		showRenameDialog.value = true;
	}

	async function renameDocument(close) {
		const title = renameTitle.value.trim();
		if (!title) {
			toast.warning(__('Name is required'));
			return;
		}
		const docKey = renameNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isRenaming.value = true;
		try {
			await draftStore.renameNode(docKey, title);
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error updating title'));
		} finally {
			isRenaming.value = false;
		}
	}

	function openExternalLinkDialog(parentKey) {
		externalLinkParent.value = parentKey;
		externalLinkTitle.value = '';
		externalLinkUrl.value = '';
		showExternalLinkDialog.value = true;
	}

	async function createExternalLink(close) {
		const title = externalLinkTitle.value.trim();
		const url = externalLinkUrl.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}
		if (!url) {
			toast.warning(__('URL is required'));
			return;
		}

		const parentKey = externalLinkParent.value;
		if (parentKey) expandedNodes.value[parentKey] = true;
		close();

		isCreating.value = true;
		try {
			const { promise } = draftStore.createNode({
				parentKey,
				title,
				isExternalLink: true,
				externalUrl: url,
			});
			await promise;
		} catch (error) {
			console.error('Error creating external link:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isCreating.value = false;
		}
	}

	function openEditExternalLinkDialog(node) {
		editExternalLinkNode.value = node;
		editExternalLinkTitle.value = node.title || '';
		editExternalLinkUrl.value = node.external_url || '';
		showEditExternalLinkDialog.value = true;
	}

	async function updateExternalLink(close) {
		const title = editExternalLinkTitle.value.trim();
		const url = editExternalLinkUrl.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}
		if (!url) {
			toast.warning(__('URL is required'));
			return;
		}
		const docKey = editExternalLinkNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isUpdatingExternalLink.value = true;
		try {
			await draftStore.updateNode(docKey, {
				title,
				external_url: url,
			});
		} catch (error) {
			console.error('Error updating external link:', error);
			toast.error(error.messages?.[0] || __('Error updating external link'));
		} finally {
			isUpdatingExternalLink.value = false;
		}
	}

	return {
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
	};
}
