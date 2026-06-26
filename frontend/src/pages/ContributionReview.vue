<template>
	<div class="flex flex-col h-full">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 border-b border-outline-gray-2 bg-surface-white shrink-0">
			<div class="flex items-center gap-4">
				<Button variant="ghost" icon-left="arrow-left" @click="goBack">
					{{ __('Back') }}
				</Button>
				<div v-if="changeRequest.doc">
					<div class="flex items-center gap-2">
						<h1 class="text-xl font-semibold text-ink-gray-9">{{ changeRequest.doc.title }}</h1>
						<Badge :variant="'subtle'" :theme="getStatusTheme(changeRequest.doc.status)" size="sm">
							{{ changeRequest.doc.status }}
						</Badge>
					</div>
					<div class="flex items-center gap-3 mt-0.5">
						<p class="text-sm text-ink-gray-5">
							{{ changeRequest.doc.wiki_space }}
							<span v-if="changeRequest.doc.owner">
								&middot; {{ __('by') }} {{ changeRequest.doc.owner }}
							</span>
						</p>
						<div v-if="assignees" class="flex items-center gap-1.5 text-sm text-ink-gray-5">
							<span>&middot;</span>
							<AssigneeAvatars :assign="assignees" />
						</div>
					</div>
				</div>
			</div>

			<div class="flex items-center gap-2">
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

					<Dropdown v-if="reviewMenuOptions.length" :options="reviewMenuOptions">
						<Button variant="ghost" :title="__('More actions')">
							<LucideMoreVertical class="size-4" />
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

		<div class="flex-1 overflow-auto p-4">
			<!-- Conflict resolution banner -->
			<div
				v-if="hasConflicts"
				class="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg"
			>
				<div class="flex items-start gap-3">
					<LucideAlertTriangle class="size-5 text-amber-500 shrink-0 mt-0.5" />
					<div>
						<p class="font-medium text-amber-800">{{ __('Merge Conflicts') }}</p>
						<p class="text-sm text-amber-700 mt-1">
							{{ __('The following documents have conflicting changes. Choose which version to keep for each conflict.') }}
						</p>
						<p class="text-sm text-amber-600 mt-2 font-medium">
							{{ resolvedCount }}/{{ conflicts.length }} {{ __('resolved') }}
						</p>
					</div>
				</div>
			</div>

			<div class="space-y-4">
				<!-- Conflict list (replaces changes list when conflicts exist) -->
				<template v-if="hasConflicts">
					<h3 class="text-lg font-medium text-ink-gray-8">
						{{ __('Conflicts') }} ({{ conflicts.length }})
					</h3>

					<div class="space-y-3">
						<div
							v-for="conflict in conflicts"
							:key="conflict.name"
							class="border border-outline-gray-2 rounded-lg overflow-hidden"
							:class="{ 'border-amber-300': !resolutions[conflict.name] }"
						>
							<div
								class="flex items-center justify-between p-4 bg-surface-gray-1 cursor-pointer"
								@click="toggleConflict(conflict.name)"
							>
								<div class="flex items-center gap-3">
									<div class="flex items-center justify-center size-8 rounded-full shrink-0 bg-amber-100 text-amber-600">
										<LucideAlertTriangle class="size-4" />
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
								<LucideChevronDown
									class="size-5 text-ink-gray-4 transition-transform"
									:class="{ 'rotate-180': expandedConflicts.has(conflict.name) }"
								/>
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

				<!-- Normal changes list -->
				<template v-else>
					<h3 class="text-lg font-medium text-ink-gray-8">
						{{ __('Changes') }} ({{ changes.data?.length || 0 }})
					</h3>

					<div v-if="changes.loading" class="flex items-center justify-center py-8">
						<LoadingIndicator class="size-8" />
					</div>

					<div v-else-if="changes.data?.length" class="space-y-3">
						<div
							v-for="change in changes.data"
							:key="change.doc_key"
							class="border border-outline-gray-2 rounded-lg overflow-hidden"
						>
							<div
								class="flex items-center justify-between p-4 bg-surface-gray-1 cursor-pointer"
								@click="toggleChange(change.doc_key)"
							>
								<div class="flex items-center gap-3">
									<div
										class="flex items-center justify-center size-8 rounded-full shrink-0"
										:class="getChangeIconClass(change.change_type)"
									>
										<component :is="getChangeIcon(change.change_type)" class="size-4" />
									</div>
									<div>
										<div class="flex items-center gap-2">
											<span class="font-medium text-ink-gray-9">
												{{ change.title || __('Untitled') }}
											</span>
											<Badge variant="subtle" :theme="getChangeTheme(change.change_type)" size="sm">
												{{ getChangeLabel(change.change_type) }}
											</Badge>
										</div>
										<p class="text-sm text-ink-gray-5">
											{{ getChangeDescription(change.change_type, change.is_group, change.is_external_link) }}
										</p>
										<p v-if="change.is_external_link && change.external_url" class="text-sm text-ink-gray-5 mt-0.5">
											<a :href="change.external_url" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">
												{{ change.external_url }}
											</a>
										</p>
									</div>
								</div>
								<LucideChevronDown
									class="size-5 text-ink-gray-4 transition-transform"
									:class="{ 'rotate-180': expandedChanges.has(change.doc_key) }"
								/>
							</div>

							<div v-if="expandedChanges.has(change.doc_key)" class="border-t border-outline-gray-2">
								<!-- A reorder is a structural move, not a content edit, so show where
								     the page sat vs. where it sits now instead of an empty content diff. -->
								<template v-if="change.change_type === 'reordered'">
									<div v-if="diffsByDocKey[change.doc_key]" class="flex items-center gap-3 flex-wrap p-4 text-sm">
										<div class="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-gray-2 text-ink-gray-6">
											<span>{{ locationPath(diffsByDocKey[change.doc_key].location?.base, change.title) }}</span>
											<Badge v-if="positionLabel(diffsByDocKey[change.doc_key].location?.base)" variant="subtle" theme="gray" size="sm">
												{{ positionLabel(diffsByDocKey[change.doc_key].location?.base) }}
											</Badge>
										</div>
										<LucideArrowRight class="size-4 text-ink-gray-4 shrink-0" />
										<div class="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-gray-2 text-ink-gray-8 font-medium">
											<span>{{ locationPath(diffsByDocKey[change.doc_key].location?.head, change.title) }}</span>
											<Badge v-if="positionLabel(diffsByDocKey[change.doc_key].location?.head)" variant="subtle" theme="orange" size="sm">
												{{ positionLabel(diffsByDocKey[change.doc_key].location?.head) }}
											</Badge>
										</div>
									</div>
									<div v-else class="flex items-center justify-center py-8">
										<LoadingIndicator class="size-6" />
									</div>
								</template>
								<template v-else>
								<div class="flex items-center justify-end gap-1 px-4 pt-3">
									<Button
										size="sm"
										:variant="viewModeFor(change.doc_key) === 'diff' ? 'subtle' : 'ghost'"
										@click.stop="setViewMode(change.doc_key, 'diff')"
									>
										{{ __('Diff') }}
									</Button>
									<Button
										size="sm"
										:variant="viewModeFor(change.doc_key) === 'preview' ? 'subtle' : 'ghost'"
										@click.stop="setViewMode(change.doc_key, 'preview')"
									>
										{{ __('Preview') }}
									</Button>
								</div>
								<div class="p-4 relative z-0 isolate">
									<template v-if="viewModeFor(change.doc_key) === 'preview'">
										<div
											v-if="diffsByDocKey[change.doc_key]"
											class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-outline-gray-2 border border-outline-gray-2 rounded-lg overflow-hidden"
										>
											<section class="bg-surface-white min-w-0">
												<header class="flex items-center gap-2 px-4 h-9 border-b border-outline-gray-2 bg-surface-gray-1">
													<span class="text-xs font-medium uppercase tracking-wide text-ink-gray-5">{{ __('Current') }}</span>
													<Badge v-if="!diffsByDocKey[change.doc_key].base" variant="subtle" theme="green" size="sm">{{ __('New page') }}</Badge>
												</header>
												<div class="px-4 py-4">
													<p v-if="!diffsByDocKey[change.doc_key].base" class="text-sm text-ink-gray-5 italic">
														{{ __('No published version yet.') }}
													</p>
													<WikiContentViewer v-else :content="diffsByDocKey[change.doc_key].base?.content || ''" />
												</div>
											</section>
											<section class="bg-surface-white min-w-0">
												<header class="flex items-center gap-2 px-4 h-9 border-b border-outline-gray-2 bg-surface-gray-1">
													<span class="text-xs font-medium uppercase tracking-wide text-ink-gray-5">{{ __('Proposed') }}</span>
												</header>
												<div class="px-4 py-4">
													<WikiContentViewer :content="diffsByDocKey[change.doc_key].head?.content || ''" />
												</div>
											</section>
										</div>
										<div v-else class="flex items-center justify-center py-8">
											<LoadingIndicator class="size-6" />
										</div>
									</template>
									<template v-else>
										<DiffViewer
											v-if="diffsByDocKey[change.doc_key]"
											:old-content="diffsByDocKey[change.doc_key]?.base?.content || ''"
											:new-content="diffsByDocKey[change.doc_key]?.head?.content || ''"
											:file-name="change.title || change.doc_key"
											language="markdown"
										/>
										<div v-else class="flex items-center justify-center py-8">
											<LoadingIndicator class="size-6" />
										</div>
									</template>
								</div>
								</template>
							</div>
						</div>
					</div>

					<div v-else class="text-center py-8 text-ink-gray-5">
						{{ __('No changes in this change request.') }}
					</div>
				</template>
			</div>
		</div>

		<Dialog v-model="showApproveMergeDialog" :options="{ size: 'md' }">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">{{ __('Approve & Merge') }}</h3>
			</template>
			<template #body-content>
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

		<Dialog v-model="showRequestChangesDialog" :options="{ size: 'md' }">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">{{ __('Request Changes') }}</h3>
			</template>
			<template #body-content>
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

		<Dialog v-model="showRejectDialog" :options="{ size: 'md' }">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">{{ __('Reject Change Request') }}</h3>
			</template>
			<template #body-content>
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
import { ref, computed, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import { createDocumentResource, createResource, Button, Badge, Dialog, Dropdown, FormControl, LoadingIndicator, toast, usePageMeta } from 'frappe-ui';
import { useUserStore } from '@/stores/user';

const router = useRouter();
import { useChangeRequestStore } from '@/stores/changeRequest';
import DiffViewer from '@/components/DiffViewer.vue';
import WikiContentViewer from '@/components/WikiContentViewer.vue';
import AssignDialog from '@/components/AssignDialog.vue';
import AssigneeAvatars from '@/components/AssigneeAvatars.vue';
import LucideChevronDown from '~icons/lucide/chevron-down';
import LucideAlertTriangle from '~icons/lucide/alert-triangle';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucideArrowRight from '~icons/lucide/arrow-right';
import { useChangeTypeDisplay } from '@/composables/useChangeTypeDisplay';

const { getChangeIcon, getChangeIconClass, getChangeTheme, getChangeLabel, getChangeDescription } = useChangeTypeDisplay();

const props = defineProps({
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
const expandedChanges = reactive(new Set());
const diffsByDocKey = reactive({});
// Per-row Diff/Preview toggle. Preview renders the base/head markdown through a
// read-only WikiContentViewer (the same TipTap config as the editor), so it
// matches what readers see rather than showing a markdown diff.
const viewModeByDocKey = reactive({});

// Conflict resolution state
const hasConflicts = ref(false);
const conflicts = ref([]);
const resolutions = reactive({});
const expandedConflicts = reactive(new Set());
const resolvingMerge = ref(false);

const resolvedCount = computed(() =>
	Object.values(resolutions).filter((v) => v === 'ours' || v === 'theirs').length,
);
const allResolved = computed(() => conflicts.value.length > 0 && resolvedCount.value === conflicts.value.length);

const changeRequest = createDocumentResource({
	doctype: 'Wiki Change Request',
	name: props.changeRequestId,
	auto: true,
});

usePageMeta(() => {
	if (!changeRequest.doc) return;
	return { title: `${changeRequest.doc.title} | Frappe Wiki` };
});

const changes = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.diff_change_request',
	params: { name: props.changeRequestId, scope: 'summary' },
	auto: true,
});

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

const diffResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.diff_change_request',
});

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

const userStore = useUserStore();
const crStore = useChangeRequestStore();
const isOwner = computed(() => changeRequest.doc?.owner === userStore.data?.name);

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
	return capabilities.value.can_write && ['In Review', 'Approved'].includes(changeRequest.doc?.status);
});

// Withdraw pulls an in-review CR back to Draft for the author to keep editing.
// Once Changes Requested the CR is already editable, so there is nothing to
// withdraw — the author just edits and resubmits.
const canWithdraw = computed(() => {
	return isOwner.value && changeRequest.doc?.status === 'In Review';
});

// Secondary reviewer decisions live in the three-dots menu so the header keeps a
// single primary action.
const reviewMenuOptions = computed(() => {
	if (hasConflicts.value) return [];
	const options = [];
	const status = changeRequest.doc?.status;
	// The header primary button is Approve-only (the two-person path: approve now,
	// merge later via the Merge button). The combined self-serve Approve & Merge
	// lives here in the menu for reviewers who want to publish in one step.
	if (status === 'In Review') {
		options.push({
			label: __('Approve & Merge'),
			icon: 'check-circle',
			onClick: () => {
				showApproveMergeDialog.value = true;
			},
		});
	}
	if (['In Review', 'Approved'].includes(status)) {
		options.push({
			label: __('Request Changes'),
			icon: 'message-square',
			onClick: () => {
				showRequestChangesDialog.value = true;
			},
		});
		options.push({
			label: __('Reject'),
			icon: 'x-circle',
			onClick: () => {
				showRejectDialog.value = true;
			},
		});
		options.push({
			label: __('Assign reviewer'),
			icon: 'user-plus',
			onClick: () => {
				showAssignDialog.value = true;
			},
		});
	}
	// The standalone Withdraw button is only shown to authors who can't review;
	// surface the same action here so an author who *can* review (e.g. a manager
	// reviewing their own CR) can still pull it back to Draft from the menu.
	if (canWithdraw.value) {
		options.push({
			label: __('Withdraw'),
			icon: 'rotate-ccw',
			onClick: handleWithdraw,
		});
	}
	return options;
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
		const result = await conflictsResource.submit({ name: props.changeRequestId });
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

// Go back to wherever the user actually came from — the originating list tab
// (with its query preserved), the space editor, etc. Fall back to the list only
// when opened directly (no history).
function goBackInFlow(fallback) {
	if (window.history.state?.back) {
		router.back();
	} else {
		router.push(fallback);
	}
}

function goBack() {
	goBackInFlow({ name: 'ChangeRequests' });
}

// Reorder display: a breadcrumb of ancestor titles ending in the page itself.
function locationPath(location, title) {
	const segments = [...(location?.path || []), title].filter(Boolean);
	return segments.join('  /  ');
}

function positionLabel(location) {
	if (!location || !location.position) return '';
	return `${__('Position')} ${location.position} / ${location.total}`;
}

function viewModeFor(docKey) {
	return viewModeByDocKey[docKey] || 'diff';
}

function setViewMode(docKey, mode) {
	// Both Diff and Preview read from the already-loaded page diff (base/head
	// markdown), so switching is purely a view toggle.
	viewModeByDocKey[docKey] = mode;
}

async function toggleChange(docKey) {
	if (expandedChanges.has(docKey)) {
		expandedChanges.delete(docKey);
		return;
	}
	expandedChanges.add(docKey);
	if (!diffsByDocKey[docKey]) {
		try {
			const result = await diffResource.submit({
				name: props.changeRequestId,
				scope: 'page',
				doc_key: docKey,
			});
			diffsByDocKey[docKey] = result;
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error loading diff'));
		}
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
		await changes.submit({ name: props.changeRequestId, scope: 'summary' });
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
		await changes.submit({ name: props.changeRequestId, scope: 'summary' });
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

function getStatusTheme(status) {
	switch (status) {
		case 'Draft': return 'blue';
		case 'In Review': return 'orange';
		case 'Changes Requested': return 'red';
		case 'Approved': return 'green';
		case 'Merged': return 'green';
		case 'Rejected': return 'red';
		case 'Archived': return 'gray';
		default: return 'gray';
	}
}

function getConflictTheme(type) {
	switch (type) {
		case 'content': return 'blue';
		case 'meta': return 'orange';
		case 'tree': return 'red';
		default: return 'gray';
	}
}

</script>
