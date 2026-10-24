import { call, getCachedDocumentResource, toast } from 'frappe-ui';

import { requestEditorFlush } from '../lib/editorContentSync';
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
		if (blocker === 'uploading') {
			return __('Wait for uploads to finish before {0}', [action]);
		}
		if (blocker === 'upload-failed') {
			return __('Remove failed uploads before {0}', [action]);
		}
		if (blocker === 'pending') {
			return __('Wait for pending changes to sync before {0}', [action]);
		}
		if (blocker === 'unsaved') {
			return __('Save your changes before {0}', [action]);
		}
		return null;
	}

	async function flushUnsavedPages() {
		requestEditorFlush();
		if (draftStore.finalizationBlocker !== 'unsaved') return true;
		const failures = await draftStore.flushDirtyPages();
		if (!failures.length) return true;
		const error = failures[0];
		toast.error(
			error?.messages?.[0] || error?.message || __('Error saving draft'),
		);
		return false;
	}

	async function submitForReview() {
		if (!(await flushUnsavedPages())) return;
		const blockerMessage = finalizationError(__('submitting'));
		if (blockerMessage) {
			toast.error(blockerMessage);
			return;
		}
		crStore.finalizing = 'submitting';
		try {
			const result = await crStore.submitForReview();
			toast.success(__('Change request submitted for review'));
			if (result?.name) {
				await router.push({
					name: 'ChangeRequestReview',
					params: { changeRequestId: result.name },
				});
			}
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error submitting for review'));
		} finally {
			crStore.finalizing = null;
		}
	}

	async function discardChangeRequest() {
		const crName = crStore.currentChangeRequest?.name;
		crStore.finalizing = 'withdrawing';
		try {
			await crStore.archiveChangeRequest();
			toast.success(__('Change request archived'));
			await draftStore.discardPersistedDraftsForCr(crName);
			spaceStore.stopEditing();
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error archiving change request'));
		} finally {
			crStore.finalizing = null;
		}
	}

	async function mergeChangeRequest() {
		if (!(await flushUnsavedPages())) return;
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
		const wasInReview = spaceStore.isEditingInReview;
		crStore.finalizing = 'merging';
		try {
			await crStore.approveAndMergeChangeRequest();
			toast.success(__('Change request merged'));
			// The CR's drafts are now merged into the published doc — clear them so a
			// stale local copy can't resurrect after the merge.
			await draftStore.discardPersistedDraftsForCr(changeRequestName);
			const mergedPage = docKey ? await documentNameFor(docKey) : null;
			const openPage = spaceStore.selectedPageId;
			if (openPage) {
				await getCachedDocumentResource('Wiki Document', openPage)?.reload();
			}
			if (wasInReview) await spaceStore.stopEditingInReview();
			else spaceStore.stopEditing();
			if (mergedPage) {
				await router.replace({
					name: 'SpacePage',
					params: { spaceId, pageId: mergedPage },
				});
			}
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

	async function finishEditingInReview() {
		if (!(await flushUnsavedPages())) return;
		const blockerMessage = finalizationError(__('finishing'));
		if (blockerMessage) {
			toast.error(blockerMessage);
			return;
		}
		const changeRequestName = crStore.currentChangeRequest?.name;
		await router.push({
			name: 'ChangeRequestReview',
			params: { changeRequestId: changeRequestName },
		});
		await spaceStore.stopEditingInReview();
	}

	return {
		submitForReview,
		discardChangeRequest,
		mergeChangeRequest,
		finishEditingInReview,
	};
}

export async function documentNameFor(docKey) {
	const result = await call('frappe.client.get_value', {
		doctype: 'Wiki Document',
		filters: { doc_key: docKey },
		fieldname: 'name',
	}).catch(() => null);
	return result?.name || null;
}
