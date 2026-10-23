<template>
	<div class="flex flex-col h-full">
		<div class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-2 px-3 sm:px-5">
			<Breadcrumbs :items="breadcrumbs" class="min-w-0 flex-1" />

			<div class="flex shrink-0 items-center gap-2">
				<Button
					v-if="canEditInReview"
					variant="outline"
					icon="lucide-pencil"
					:aria-label="__('Edit')"
					:title="__('Edit')"
					:loading="startingEdit"
					@click="handleEdit"
				/>

				<template v-if="canReview">
					<Button
						v-if="hasConflicts"
						variant="solid"
						:disabled="!allResolved"
						:loading="resolvingMerge"
						@click="handleResolveAndMerge"
					>
						{{ __('Resolve & Merge') }}
					</Button>
					<Button
						v-else-if="changeRequest.doc?.status === 'Approved'"
						variant="solid"
						:loading="mergeResource.loading"
						@click="handleMerge"
					>
						{{ __('Merge') }}
					</Button>
					<Button
						v-else
						variant="solid"
						:loading="approveResource.loading"
						@click="handleApprove"
					>
						{{ __('Approve') }}
					</Button>

					<Dropdown v-if="reviewMenuOptions.length" :options="reviewMenuOptions" align="end">
						<Button variant="subtle" :title="__('More actions')">
							<span class="lucide-more-horizontal size-4" aria-hidden="true" />
						</Button>
					</Dropdown>
				</template>

				<Button
					v-else-if="canWithdraw"
					variant="outline"
					:loading="withdrawResource.loading"
					@click="handleWithdraw"
				>
					{{ __('Withdraw') }}
				</Button>
			</div>
		</div>

		<div class="flex-1 overflow-auto">
		<div class="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-5">
			<div v-if="changeRequest.doc" class="mb-8">
				<Badge variant="subtle" :theme="statusTheme(changeRequest.doc.status)">
					{{ changeRequest.doc.status }}
				</Badge>
				<h1 class="mt-2 text-2xl-semibold text-ink-gray-9">{{ changeRequest.doc.title }}</h1>
				<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-gray-5">
					<Avatar
						:image="review.data?.author.image"
						:label="authorName"
						size="sm"
					/>
					<span class="text-ink-gray-7">{{ authorName }}</span>
					<span>
						{{ __('opened {0}', [dayjsLocal(changeRequest.doc.creation).fromNow()]) }}
						<template v-if="pages.length">· {{ pageCount }}</template>
					</span>
					<template v-if="assignees">
						<span>&middot;</span>
						<AssigneeAvatars :assign="assignees" />
					</template>
				</div>
				<p
					v-if="changeRequest.doc.description"
					class="mt-4 max-w-3xl whitespace-pre-line text-p-base text-ink-gray-7"
				>
					{{ changeRequest.doc.description }}
				</p>
			</div>
			<!-- Conflict resolution banner -->
			<div
				v-if="hasConflicts"
				class="mb-4 p-4 bg-surface-amber-2 border border-outline-amber-2 rounded-6"
			>
				<div class="flex items-start gap-3">
					<span class="lucide-alert-triangle size-5 text-ink-amber-5 shrink-0 mt-0.5" aria-hidden="true" />
					<div>
						<p class="font-medium text-ink-amber-7">{{ __('Merge Conflicts') }}</p>
						<p class="text-sm text-ink-amber-6 mt-1">
							{{ __('The following documents have conflicting changes. Choose which version to keep for each conflict.') }}
						</p>
						<p class="text-sm-medium text-ink-amber-5 mt-2">
							{{ resolvedCount }}/{{ conflicts.length }} {{ __('resolved') }}
						</p>
					</div>
				</div>
			</div>

			<div class="space-y-4">
				<!-- Conflict list (replaces changes list when conflicts exist) -->
				<template v-if="hasConflicts">
					<h3 class="text-lg-medium text-ink-gray-8">
						{{ __('Conflicts') }} ({{ conflicts.length }})
					</h3>

					<div class="space-y-3">
						<div
							v-for="conflict in conflicts"
							:key="conflict.name"
							class="border border-outline-gray-2 rounded-6 overflow-hidden"
							:class="{ 'border-outline-amber-3': !resolutions[conflict.name] }"
						>
							<div
								class="flex items-center justify-between p-4 bg-surface-gray-1 cursor-pointer"
								@click="toggleConflict(conflict.name)"
							>
								<div class="flex items-center gap-3">
									<div class="flex items-center justify-center size-8 rounded-full shrink-0 bg-surface-amber-2 text-ink-amber-5">
										<span class="lucide-alert-triangle size-4" aria-hidden="true" />
									</div>
									<div>
										<div class="flex items-center gap-2">
											<span class="font-medium text-ink-gray-9">
												{{ conflict.ours_title || conflict.theirs_title || conflict.doc_key }}
											</span>
											<Badge variant="subtle" :theme="getConflictTheme(conflict.conflict_type)" size="sm">
												{{ conflict.conflict_type }}
											</Badge>
											<Badge
												v-if="resolutions[conflict.name]"
												variant="subtle"
												theme="green"
												size="sm"
											>
												{{ resolutions[conflict.name] === 'ours' ? __('Keep Main') : __('Keep Your Changes') }}
											</Badge>
										</div>
									</div>
								</div>
								<span
									class="lucide-chevron-down size-5 text-ink-gray-4 transition-transform"
									:class="{ 'rotate-180': expandedConflicts.has(conflict.name) }" aria-hidden="true" />
							</div>

							<div v-if="expandedConflicts.has(conflict.name)" class="border-t border-outline-gray-2">
								<div class="grid grid-cols-2 gap-4 px-4 pt-4">
									<FormControl
										type="checkbox"
										:label="__('Keep Main')"
										:modelValue="resolutions[conflict.name] === 'ours'"
										@update:modelValue="setResolution(conflict.name, 'ours')"
									/>
									<FormControl
										type="checkbox"
										:label="__('Keep Your Changes')"
										:modelValue="resolutions[conflict.name] === 'theirs'"
										@update:modelValue="setResolution(conflict.name, 'theirs')"
									/>
								</div>
								<div class="p-4 relative z-0 isolate">
									<DiffViewer
										:old-content="conflict.ours_content || ''"
										:new-content="conflict.theirs_content || ''"
										:file-name="conflict.ours_title || conflict.theirs_title || conflict.doc_key"
										language="markdown"
									/>
								</div>
							</div>
						</div>
					</div>
				</template>

				<template v-else>
					<div class="flex flex-wrap items-center gap-3">
						<h3 class="text-lg-semibold text-ink-gray-8">{{ __('Changes') }}</h3>
						<Switch
							v-if="view !== 'markdown'"
							v-model="changesOnly"
							:label="__('Show changes only')"
							class="ml-auto"
						/>
						<TabButtons v-model="view" :options="viewOptions" />
					</div>

					<div v-if="review.loading && !review.data" class="flex items-center justify-center py-8">
						<LoadingIndicator class="size-8" />
					</div>

					<div v-else-if="pages.length" class="space-y-4">
						<PageDiff
							v-for="page in pages"
							:key="page.doc_key"
							:page="page"
							:view="view"
							:changes-only="changesOnly"
						/>
					</div>

					<div v-else class="flex flex-col items-center gap-2 rounded-5 border border-dashed border-outline-gray-2 py-12 text-center">
						<p class="text-base text-ink-gray-7">{{ __('No changes yet') }}</p>
						<p class="text-p-sm text-ink-gray-5">{{ __('Edit a page and it shows up here.') }}</p>
					</div>
				</template>
			</div>
		</div>
		</div>

		<Dialog v-model:open="showApproveMergeDialog" size="md">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">{{ __('Approve & Merge') }}</h3>
			</template>
			<template #default>
				<p class="text-ink-gray-7">
					{{ __('This will approve the change request and immediately merge it into the live wiki. This cannot be undone. Are you sure?') }}
				</p>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						:loading="approveResource.loading || mergeResource.loading"
						@click="handleApproveAndMerge(close)"
					>
						{{ __('Approve & Merge') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model:open="showRequestChangesDialog" size="md">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">{{ __('Request Changes') }}</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<p class="text-ink-gray-7">
						{{ __('Please provide feedback explaining what needs to change. This is sent back to the author.') }}
					</p>
					<FormControl
						v-model="requestChangesComment"
						type="textarea"
						:label="__('Feedback')"
						:placeholder="__('Enter your feedback...')"
						:rows="4"
					/>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						theme="red"
						:loading="requestChangesResource.loading"
						@click="handleRequestChanges(close)"
					>
						{{ __('Request Changes') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model:open="showRejectDialog" size="md">
			<template #title>
				<h3 class="text-2xl-semibold text-ink-gray-9">{{ __('Reject Change Request') }}</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<p class="text-ink-gray-7">
						{{ __('Rejecting is final — this change request cannot be merged. Please explain why it is being rejected.') }}
					</p>
					<FormControl
						v-model="rejectComment"
						type="textarea"
						:label="__('Reason')"
						:placeholder="__('Enter the reason for rejection...')"
						:rows="4"
					/>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						theme="red"
						:loading="rejectResource.loading"
						@click="handleReject(close)"
					>
						{{ __('Reject') }}
					</Button>
				</div>
			</template>
		</Dialog>

		<AssignDialog
			v-model="showAssignDialog"
			:change-request-id="props.changeRequestId"
			@assigned="assigneesResource.reload()"
		/>
	</div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import {
	Avatar,
	Badge,
	Breadcrumbs,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	LoadingIndicator,
	Switch,
	TabButtons,
	createDocumentResource,
	createResource,
	dayjsLocal,
	toast,
	usePageMeta,
} from 'frappe-ui';
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
import AssignDialog from '@/components/AssignDialog.vue';
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';
import PageDiff from '@/components/PageDiff.vue';
import { documentNameFor } from '@/composables/useChangeRequestActions';
import { useMobile } from '@/composables/useMobile';
import { statusTheme } from '@/lib/changeRequestStatus';
import { destructiveMenuOption } from '@/lib/menu';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useSpaceStore } from '@/stores/space';

const DiffViewer = defineAsyncComponent(
	() => import('@/components/DiffViewer.vue'),
);

const props = defineProps({
	spaceId: {
		type: String,
		required: true,
	},
	changeRequestId: {
		type: String,
		required: true,
	},
});

const showApproveMergeDialog = ref(false);
const showRequestChangesDialog = ref(false);
const requestChangesComment = ref('');
const showRejectDialog = ref(false);
const rejectComment = ref('');
const showAssignDialog = ref(false);
const { isMobile } = useMobile();
const chosenView = ref('split');
// A phone has no room for two columns.
const view = computed({
	get: () =>
		isMobile.value && chosenView.value === 'split' ? 'inline' : chosenView.value,
	set: (value) => {
		chosenView.value = value;
	},
});
const changesOnly = ref(false);
const viewOptions = computed(() =>
	[
		{ value: 'split', label: __('Side by side'), icon: 'lucide-columns-2' },
		{ value: 'inline', label: __('Inline'), icon: 'lucide-rows-2' },
		{ value: 'markdown', label: __('Markdown'), icon: 'lucide-code' },
	].filter((option) => !isMobile.value || option.value !== 'split'),
);

// Conflict resolution state
const hasConflicts = ref(false);
const conflicts = ref([]);
const resolutions = reactive({});
const expandedConflicts = reactive(new Set());
const resolvingMerge = ref(false);

const resolvedCount = computed(
	() =>
		Object.values(resolutions).filter((v) => v === 'ours' || v === 'theirs')
			.length,
);
const allResolved = computed(
	() =>
		conflicts.value.length > 0 &&
		resolvedCount.value === conflicts.value.length,
);

const changeRequest = createDocumentResource({
	doctype: 'Wiki Change Request',
	name: props.changeRequestId,
	auto: true,
});

usePageMeta(() => {
	if (!changeRequest.doc) return;
	return { title: `${changeRequest.doc.title} | Frappe Wiki` };
});

const review = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_change_request_review',
	method: 'GET',
	params: { name: props.changeRequestId },
	auto: true,
});
const pages = computed(() => review.data?.pages ?? []);
const authorName = computed(
	() => review.data?.author.full_name || changeRequest.doc?.owner,
);
const pageCount = computed(() =>
	pages.value.length === 1
		? __('1 page')
		: __('{0} pages', [pages.value.length]),
);

// `_assign` is a native column that `frappe.client.get` (the document resource)
// strips out, so it is fetched separately to surface the current assignees.
const assigneesResource = createResource({
	url: 'frappe.client.get_value',
	params: {
		doctype: 'Wiki Change Request',
		filters: { name: props.changeRequestId },
		fieldname: '_assign',
	},
	auto: true,
});
const assignees = computed(() => assigneesResource.data?._assign || '');

const mergeResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.merge_change_request',
});

const conflictsResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_merge_conflicts',
});

const resolveResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.resolve_merge_conflict',
});

const retryResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.retry_merge_after_resolution',
});

const approveResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.approve_change_request',
});

const requestChangesResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.request_changes',
});

const rejectResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.reject_change_request',
});

const withdrawResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.withdraw_change_request',
});

const spaceStore = useSpaceStore();
const breadcrumbs = computed(() => [
	{
		label: spaceStore.doc?.space_name || props.spaceId,
		route: { name: 'SpaceDetails', params: { spaceId: props.spaceId } },
	},
	{ label: __('Change requests'), route: { name: 'ChangeRequests' } },
	{ label: changeRequest.doc?.title || props.changeRequestId },
]);

watch(
	() => changeRequest.doc?.status,
	(status, before) => {
		if (before && status !== before) spaceStore.reload();
	},
);

// A link can name the wrong space; the sidebar must show the one being changed.
watch(
	() => changeRequest.doc?.wiki_space,
	(space) => {
		if (space && space !== props.spaceId)
			router.replace({
				name: 'SpaceChangeRequest',
				params: { spaceId: space, changeRequestId: props.changeRequestId },
			});
	},
);

const userStore = useUserStore();
const crStore = useChangeRequestStore();
const isOwner = computed(
	() => changeRequest.doc?.owner === userStore.data?.name,
);

// Merge ability is governed per-space by the role config (managers always qualify).
// Enforcement stays server-side; this only controls whether the Merge UI shows.
const capabilities = ref({ can_read: false, can_write: false });
const capabilitiesResource = createResource({
	url: 'wiki.api.get_space_capabilities',
	onSuccess: (data) => {
		capabilities.value = data;
	},
});

watch(
	() => changeRequest.doc?.wiki_space,
	(space) => {
		if (space) capabilitiesResource.submit({ space });
	},
	{ immediate: true },
);

const canReview = computed(() => {
	return (
		capabilities.value.can_write &&
		['In Review', 'Approved'].includes(changeRequest.doc?.status)
	);
});

// Withdraw pulls an in-review CR back to Draft for the author to keep editing.
// Once Changes Requested the CR is already editable, so there is nothing to
// withdraw — the author just edits and resubmits.
const canWithdraw = computed(() => {
	return isOwner.value && changeRequest.doc?.status === 'In Review';
});

// Mirrors can_edit_in_review on the server, which enforces it.
const canEditInReview = computed(() => {
	return (
		capabilities.value.can_contribute &&
		(isOwner.value || capabilities.value.can_write) &&
		['In Review', 'Approved'].includes(changeRequest.doc?.status)
	);
});

const startingEdit = ref(false);

// Opens the space on the first page the change request touches, in the editor.
async function handleEdit() {
	const doc = changeRequest.doc;
	startingEdit.value = true;
	try {
		await spaceStore.editInReview(doc);
		const page = pages.value.find(
			(change) =>
				change.change_type !== 'deleted' &&
				!change.is_group &&
				!change.is_external_link,
		);
		const pageId = page ? await documentNameFor(page.doc_key) : null;
		const spaceId = doc.wiki_space;
		if (pageId) {
			await router.push({ name: 'SpacePage', params: { spaceId, pageId } });
		} else if (page) {
			await router.push({
				name: 'DraftChangeRequest',
				params: { spaceId, docKey: page.doc_key },
			});
		} else {
			await router.push({ name: 'SpaceDetails', params: { spaceId } });
		}
	} finally {
		startingEdit.value = false;
	}
}

// Approve stays in the header, so the menu only carries the combined Approve & merge.
const reviewMenuOptions = computed(() => {
	if (hasConflicts.value) return [];
	const status = changeRequest.doc?.status;
	const groups = [];
	if (['In Review', 'Approved'].includes(status)) {
		const decisions = [
			{
				label: __('Request changes'),
				description: __('Send feedback to the author'),
				icon: 'lucide-message-circle',
				onClick: () => {
					showRequestChangesDialog.value = true;
				},
			},
		];
		if (status === 'In Review') {
			decisions.unshift({
				label: __('Approve & merge'),
				description: __('Approve and merge in one step'),
				icon: 'lucide-git-merge',
				onClick: () => {
					showApproveMergeDialog.value = true;
				},
			});
		}
		groups.push(
			{ group: __('Review decision'), options: decisions },
			{
				group: __('Reviewers'),
				options: [
					{
						label: __('Assign reviewer'),
						icon: 'lucide-user-plus',
						onClick: () => {
							showAssignDialog.value = true;
						},
					},
				],
			},
		);
	}
	// Authors who can also review have no standalone Withdraw button.
	if (canWithdraw.value) {
		groups.push({
			group: __('Author'),
			hideLabel: true,
			options: [
				{
					label: __('Withdraw'),
					icon: 'lucide-rotate-ccw',
					onClick: handleWithdraw,
				},
			],
		});
	}
	if (['In Review', 'Approved'].includes(status)) {
		groups.push({
			group: __('Reject'),
			hideLabel: true,
			options: [
				destructiveMenuOption({
					label: __('Reject review'),
					description: __('Decline this review'),
					icon: 'lucide-circle-x',
					onClick: () => {
						showRejectDialog.value = true;
					},
				}),
			],
		});
	}
	return groups;
});

function setResolution(conflictName, value) {
	if (resolutions[conflictName] === value) {
		delete resolutions[conflictName];
	} else {
		resolutions[conflictName] = value;
	}
}

function toggleConflict(conflictName) {
	if (expandedConflicts.has(conflictName)) {
		expandedConflicts.delete(conflictName);
	} else {
		expandedConflicts.add(conflictName);
	}
}

async function fetchConflicts() {
	try {
		const result = await conflictsResource.submit({
			name: props.changeRequestId,
		});
		conflicts.value = result || [];
		// Default all resolutions to 'theirs' (Keep Your Changes)
		for (const key in resolutions) delete resolutions[key];
		for (const conflict of conflicts.value) {
			resolutions[conflict.name] = 'theirs';
		}
		hasConflicts.value = conflicts.value.length > 0;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error loading conflicts'));
	}
}

// Merge an already-Approved CR. On a merge-conflict ValidationError the CR
// stays Approved and the conflict-resolution flow takes over.
async function mergeNow() {
	try {
		await mergeResource.submit({ name: props.changeRequestId });
		toast.success(__('Change request merged'));
		if (crStore.currentChangeRequest?.name === props.changeRequestId) {
			crStore.currentChangeRequest = null;
		}
		changeRequest.reload();
		review.reload();
		return true;
	} catch (error) {
		const msg = error.messages?.[0] || '';
		if (error.exc_type === 'ValidationError') {
			await fetchConflicts();
			if (!hasConflicts.value) {
				toast.error(msg || __('Error merging change request'));
			}
		} else {
			toast.error(msg || __('Error merging change request'));
		}
		return false;
	}
}

async function handleMerge() {
	await mergeNow();
}

// Approve without merging — leaves the CR Approved for a different person to
// merge (the two-person path). Distinct from Approve & Merge (self-serve).
async function handleApprove() {
	try {
		await approveResource.submit({ name: props.changeRequestId });
		toast.success(__('Change request approved'));
		changeRequest.reload();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error approving change request'));
	}
}

// Self-serve path: approve, then immediately merge. If approve fails we never
// attempt the merge; if the merge conflicts the CR is left Approved.
async function handleApproveAndMerge(close) {
	try {
		await approveResource.submit({ name: props.changeRequestId });
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error approving change request'));
		return;
	}
	changeRequest.reload();
	close?.();
	await mergeNow();
}

async function handleRequestChanges(close) {
	if (!requestChangesComment.value.trim()) {
		toast.warning(__('Please provide feedback'));
		return;
	}
	try {
		await requestChangesResource.submit({
			name: props.changeRequestId,
			comment: requestChangesComment.value.trim(),
		});
		toast.success(__('Requested changes'));
		requestChangesComment.value = '';
		close?.();
		changeRequest.reload();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error requesting changes'));
	}
}

async function handleResolveAndMerge() {
	resolvingMerge.value = true;
	try {
		for (const conflict of conflicts.value) {
			try {
				await resolveResource.submit({
					conflict_name: conflict.name,
					resolution: resolutions[conflict.name],
				});
			} catch (e) {
				const errMsg = e.messages?.[0] || '';
				if (errMsg.includes('already resolved')) {
					continue;
				}
				throw e;
			}
		}
		await retryResource.submit({ name: props.changeRequestId });
		toast.success(__('Conflicts resolved and change request merged'));
		hasConflicts.value = false;
		conflicts.value = [];
		if (crStore.currentChangeRequest?.name === props.changeRequestId) {
			crStore.currentChangeRequest = null;
		}
		changeRequest.reload();
		review.reload();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error resolving conflicts'));
	} finally {
		resolvingMerge.value = false;
	}
}

async function handleReject(close) {
	if (!rejectComment.value.trim()) {
		toast.warning(__('Please provide a reason'));
		return;
	}
	try {
		await rejectResource.submit({
			name: props.changeRequestId,
			comment: rejectComment.value.trim(),
		});
		toast.success(__('Change request rejected'));
		rejectComment.value = '';
		close?.();
		changeRequest.reload();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error rejecting change request'));
	}
}

// Withdraw returns an in-review CR to Draft, re-opening it for editing.
async function handleWithdraw() {
	try {
		await withdrawResource.submit({ name: props.changeRequestId });
		toast.success(__('Change request withdrawn'));
		// Clear the local-first drafts for this CR so its content can't be
		// restored from IndexedDB after it's been discarded.
		const { clearDraftsForCr } = await import('@/stores/draftPersistence');
		await clearDraftsForCr(props.changeRequestId);
		changeRequest.reload();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error withdrawing change request'));
	}
}

function getConflictTheme(type) {
	switch (type) {
		case 'content':
			return 'blue';
		case 'meta':
			return 'amber';
		case 'tree':
			return 'red';
		default:
			return 'gray';
	}
}
</script>
