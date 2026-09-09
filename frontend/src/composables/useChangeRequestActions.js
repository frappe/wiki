import { toast } from 'frappe-ui';

import router from '../router';
import { useChangeRequestStore } from '../stores/changeRequest';
import { useDraftWorkspaceStore } from '../stores/draftWorkspace';
import { useSpaceStore } from '../stores/space';

/**
 * Submit / discard / merge for the space's open change request.
 *
 * These used to live in SpaceDetails, next to the banner that triggered them.
 * The mode strip that replaced the banner renders in the sidebar — a sibling of
 * the page — so the actions moved out of the component tree entirely. They read
 * everything they need from the stores and the route.
 */
export function useChangeRequestActions() {
	const crStore = useChangeRequestStore();
	const draftStore = useDraftWorkspaceStore();
	const spaceStore = useSpaceStore();

	function finalizationError(action) {
		const blocker = draftStore.finalizationBlocker;
		if (blocker === 'conflict') {
			return __('Reload latest before {0}', [action]);
		}
		if (blocker === 'failed') {
			return __('Resolve failed changes before {0}', [action]);
		}
		if (blocker === 'pending') {
			return __('Wait for pending changes to sync before {0}', [action]);
		}
		if (blocker === 'unsaved') {
			return __('Save your changes before {0}', [action]);
		}
		return null;
	}

	async function submitForReview() {
		// Nothing offers a Save button any more, so an unsaved buffer is not the
		// user's problem to solve before submitting: drain it here, then judge
		// the blockers that a flush cannot clear (conflicts, failed mutations).
		if (draftStore.finalizationBlocker === 'unsaved') {
			const failures = await draftStore.flushDirtyPages();
			if (failures.length) {
				const error = failures[0];
				toast.error(
					error?.messages?.[0] || error?.message || __('Error saving draft'),
				);
				return;
			}
		}
		const blockerMessage = finalizationError(__('submitting'));
		if (blockerMessage) {
			toast.error(blockerMessage);
			return;
		}
		try {
			const result = await crStore.submitForReview();
			toast.success(__('Change request submitted for review'));
			if (result?.name) {
				router.push({
					name: 'ChangeRequestReview',
					params: { changeRequestId: result.name },
				});
			}
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error submitting for review'));
		}
	}

	async function discardChangeRequest() {
		const spaceId = spaceStore.spaceId;
		const crName = crStore.currentChangeRequest?.name;
		crStore.finalizing = 'withdrawing';
		try {
			await crStore.archiveChangeRequest();
			toast.success(__('Change request archived'));
			crStore.currentChangeRequest = null;
			crStore.clearChanges();
			// Drop the local-first drafts too, or hydrate restores the discarded
			// content from IndexedDB (and autosave re-creates the change request).
			await draftStore.discardPersistedDraftsForCr(crName);
			// Same as merge: the published tree the next CR opens on is the one
			// already rendered, so it stays put while hydrate refreshes it.
			draftStore.reset({ keepTree: true });
			await draftStore.hydrate(spaceId);
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error archiving change request'));
		} finally {
			crStore.finalizing = null;
		}
	}

	function findNodeByDocKey(nodes, docKey) {
		if (!nodes) return null;
		for (const node of nodes) {
			if (node.doc_key === docKey) return node;
			const found = findNodeByDocKey(node.children, docKey);
			if (found) return found;
		}
		return null;
	}

	async function mergeChangeRequest() {
		if (spaceStore.isTreeReordering) {
			toast.error(__('Please wait for reordering to finish before merging'));
			return;
		}
		const blockerMessage = finalizationError(__('merging'));
		if (blockerMessage) {
			toast.error(blockerMessage);
			return;
		}
		const spaceId = spaceStore.spaceId;
		const docKey = spaceStore.selectedDraftKey;
		const changeRequestName = crStore.currentChangeRequest?.name;
		// Held across the rehydrate as well as the merge itself, so the strip shows
		// one state for the whole trip instead of the CR's intermediate ones.
		crStore.finalizing = 'merging';
		try {
			await crStore.approveAndMergeChangeRequest();
			toast.success(__('Change request merged'));
			crStore.currentChangeRequest = null;
			crStore.clearChanges();
			// The CR's drafts are now merged into the published doc — clear them so a
			// stale local copy can't resurrect after the merge.
			await draftStore.discardPersistedDraftsForCr(changeRequestName);
			// Keep the tree on screen: the merged tree is all but identical to the one
			// already rendered, so blanking it to a skeleton for a round trip is pure
			// loss. hydrate() swaps in the new one in a single paint.
			draftStore.reset({ keepTree: true });

			// Leave the draft route before the rehydrate, not after: the draft the
			// URL points at no longer exists, so waiting would park the editor on
			// "Draft not found" for the length of the round trip. The tree is still
			// on screen (keepTree), so the published page is resolvable now — except
			// for a page created in this CR, which only gets a document_name once
			// the merge lands, so that one is resolved again afterwards.
			const openMergedPage = () => {
				if (!docKey) return true;
				const node = findNodeByDocKey(spaceStore.treeData?.children, docKey);
				if (!node?.document_name) return false;
				router.push({
					name: 'SpacePage',
					params: { spaceId, pageId: node.document_name },
				});
				return true;
			};

			const opened = openMergedPage();
			await draftStore.hydrate(spaceId);
			if (!opened) openMergedPage();
		} catch (error) {
			// A merge conflict leaves the CR Approved; the conflict-resolution UI
			// lives on the review page, so send the author there to resolve it.
			if (error.exc_type === 'ValidationError' && changeRequestName) {
				toast.error(
					error.messages?.[0] || __('Merge conflict — resolve it to continue'),
				);
				router.push({
					name: 'ChangeRequestReview',
					params: { changeRequestId: changeRequestName },
				});
				return;
			}
			toast.error(error.messages?.[0] || __('Error merging change request'));
		} finally {
			crStore.finalizing = null;
		}
	}

	return { submitForReview, discardChangeRequest, mergeChangeRequest };
}
