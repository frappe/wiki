<template>
	<div
		v-if="isChangeRequestMode"
		class="contribution-banner px-4 py-3 flex items-center justify-between gap-4"
		:class="bannerClass"
	>
		<div class="flex items-center gap-3">
			<component :is="bannerIcon" class="size-5 shrink-0" />
			<div>
				<p class="text-sm font-medium">{{ bannerTitle }}</p>
				<p class="text-xs opacity-80">{{ bannerDescription }}</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				v-if="changeCount > 0"
				class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer bg-gray-100 text-gray-700 hover:bg-gray-200"
				@click="showChangesDialog = true"
			>
				<LucideList class="size-3.5" />
				{{ changeCount }} {{ changeCount === 1 ? __('change') : __('changes') }}
			</button>

			<template v-if="changeRequestStatus === 'Draft' || changeRequestStatus === 'Changes Requested'">
				<Button
					v-if="canShowMerge"
					size="sm"
					:loading="mergeResource?.loading"
					@click="$emit('merge')"
				>
					{{ __('Merge') }}
				</Button>
				<Button
					v-if="changeCount > 0"
					size="sm"
					:loading="submitReviewResource?.loading"
					@click="showSubmitConfirmDialog = true"
				>
					{{ __('Submit for Review') }}
				</Button>
			</template>

			<template v-else-if="changeRequestStatus === 'Approved'">
				<span class="text-sm font-medium text-green-700">
					{{ __('Approved! Ready to merge.') }}
				</span>
				<Button
					v-if="canShowMerge"
					size="sm"
					:loading="mergeResource?.loading"
					@click="$emit('merge')"
				>
					{{ __('Merge') }}
				</Button>
			</template>

			<Button
				v-if="canShowArchive"
				variant="outline"
				theme="red"
				size="sm"
				:loading="archiveChangeRequestResource?.loading"
				@click="$emit('withdraw')"
			>
				{{ __('Archive') }}
			</Button>
		</div>

		<Dialog v-model="showChangesDialog" :options="{ size: 'lg' }">
			<template #body-title>
				<div class="flex items-center gap-2">
					<LucideGitBranch class="size-5 text-ink-gray-5" />
					<h3 class="text-xl font-semibold text-ink-gray-9">
						{{ __('Pending Changes') }}
					</h3>
				</div>
			</template>
			<template #body-content>
				<div class="space-y-3 max-h-[60vh] overflow-y-auto">
					<div
						v-for="change in changes"
						:key="change.doc_key"
						class="flex items-start gap-3 p-3 rounded-lg border border-outline-gray-2 hover:bg-surface-gray-1"
					>
						<div
							class="flex items-center justify-center size-8 rounded-full shrink-0"
							:class="getChangeIconClass(change.change_type)"
						>
							<component :is="getChangeIcon(change.change_type)" class="size-4" />
						</div>

						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium text-ink-gray-9 truncate">
									{{ change.title || __('Untitled') }}
								</span>
								<Badge variant="subtle" :theme="getChangeTheme(change.change_type)" size="sm">
									{{ getChangeLabel(change.change_type) }}
								</Badge>
							</div>
							<p class="text-sm text-ink-gray-5 mt-0.5">
								{{ getChangeDescription(change.change_type, change.is_group, change.is_external_link) }}
							</p>
							<p v-if="change.is_external_link && change.external_url" class="text-sm text-ink-gray-5 mt-0.5 truncate">
								<a :href="change.external_url" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">
									{{ change.external_url }}
								</a>
							</p>
						</div>

						<div class="flex items-center gap-1 text-ink-gray-4 shrink-0">
							<LucideFolder v-if="change.is_group" class="size-4" />
							<LucideLink v-else-if="change.is_external_link" class="size-4" />
							<LucideFileText v-else class="size-4" />
						</div>
					</div>

					<div v-if="changes.length === 0" class="text-center py-8 text-ink-gray-5">
						{{ __('No pending changes') }}
					</div>
				</div>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end">
					<Button variant="outline" @click="close">{{ __('Close') }}</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showSubmitConfirmDialog" :options="{ size: 'sm' }">
			<template #body-title>
				<div class="flex items-center gap-2">
					<LucideGitBranch class="size-5 text-ink-gray-5" />
					<h3 class="text-xl font-semibold text-ink-gray-9">
						{{ __('Submit for Review') }}
					</h3>
				</div>
			</template>
			<template #body-content>
				<p class="text-ink-gray-7">
					{{ __('Are you sure you want to submit your changes for review?') }}
				</p>
				<p class="text-sm text-ink-gray-5 mt-2">
					{{ __('You have {0} pending {1}.', [changeCount, changeCount === 1 ? __('change') : __('changes')]) }}
				</p>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						:loading="submitReviewResource?.loading"
						@click="confirmSubmit(close)"
					>
						{{ __('Submit') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Badge, Button, Dialog } from 'frappe-ui';
import LucideGitBranch from '~icons/lucide/git-branch';
import LucideClock from '~icons/lucide/clock';
import LucideCheckCircle from '~icons/lucide/check-circle';
import LucideXCircle from '~icons/lucide/x-circle';
import LucideAlertCircle from '~icons/lucide/alert-circle';
import LucideArrowUpDown from '~icons/lucide/arrow-up-down';
import LucideList from '~icons/lucide/list';
import LucidePlus from '~icons/lucide/plus';
import LucidePencil from '~icons/lucide/pencil';
import LucideTrash2 from '~icons/lucide/trash-2';
import LucideFolder from '~icons/lucide/folder';
import LucideFileText from '~icons/lucide/file-text';
import LucideLink from '~icons/lucide/link';

const props = defineProps({
	isChangeRequestMode: {
		type: Boolean,
		default: false,
	},
	changeRequestStatus: {
		type: String,
		default: 'Draft',
	},
	changeCount: {
		type: Number,
		default: 0,
	},
	changes: {
		type: Array,
		default: () => [],
	},
	submitReviewResource: {
		type: Object,
		default: null,
	},
	archiveChangeRequestResource: {
		type: Object,
		default: null,
	},
	mergeResource: {
		type: Object,
		default: null,
	},
	canMerge: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['submit', 'withdraw', 'merge']);

const showChangesDialog = ref(false);
const showSubmitConfirmDialog = ref(false);

function confirmSubmit(closeDialog) {
	closeDialog();
	emit('submit');
}

const canShowMerge = computed(() => {
	return props.canMerge && props.changeCount > 0;
});

const canShowArchive = computed(() => {
	return props.changeCount > 0 && (props.changeRequestStatus === 'Draft' || props.changeRequestStatus === 'In Review' || props.changeRequestStatus === 'Changes Requested');
})

function getChangeIcon(changeType) {
	switch (changeType) {
		case 'added': return LucidePlus;
		case 'modified': return LucidePencil;
		case 'deleted': return LucideTrash2;
		case 'reordered': return LucideArrowUpDown;
		default: return LucideFileText;
	}
}

function getChangeIconClass(changeType) {
	switch (changeType) {
		case 'added': return 'bg-green-100 text-green-600';
		case 'modified': return 'bg-blue-100 text-blue-600';
		case 'deleted': return 'bg-red-100 text-red-600';
		case 'reordered': return 'bg-amber-100 text-amber-600';
		default: return 'bg-gray-100 text-gray-600';
	}
}

function getChangeTheme(changeType) {
	switch (changeType) {
		case 'added': return 'green';
		case 'modified': return 'blue';
		case 'deleted': return 'red';
		case 'reordered': return 'orange';
		default: return 'gray';
	}
}

function getChangeLabel(changeType) {
	switch (changeType) {
		case 'added': return __('New');
		case 'modified': return __('Modified');
		case 'deleted': return __('Deleted');
		case 'reordered': return __('Reordered');
		default: return changeType;
	}
}

function getChangeDescription(changeType, isGroup, isExternalLink) {
	switch (changeType) {
		case 'added':
			if (isGroup) return __('New group to be created');
			if (isExternalLink) return __('New external link added');
			return __('New page to be created');
		case 'modified':
			return __('Content or metadata updated');
		case 'deleted':
			return __('Will be deleted');
		case 'reordered':
			return __('Order updated');
		default:
			return '';
	}
}

const bannerClass = computed(() => {
	switch (props.changeRequestStatus) {
		case 'Draft':
			return 'bg-blue-50 border-b border-blue-200 text-blue-800';
		case 'In Review':
			return 'bg-amber-50 border-b border-amber-200 text-amber-800';
		case 'Changes Requested':
			return 'bg-red-50 border-b border-red-200 text-red-800';
		case 'Approved':
			return 'bg-green-50 border-b border-green-200 text-green-800';
		case 'Merged':
			return 'bg-green-50 border-b border-green-200 text-green-800';
		default:
			return 'bg-gray-50 border-b border-gray-200 text-gray-800';
	}
});

const bannerIcon = computed(() => {
	switch (props.changeRequestStatus) {
		case 'Draft':
			return LucideGitBranch;
		case 'In Review':
			return LucideClock;
		case 'Changes Requested':
			return LucideXCircle;
		case 'Approved':
			return LucideCheckCircle;
		default:
			return LucideAlertCircle;
	}
});

const bannerTitle = computed(() => {
	switch (props.changeRequestStatus) {
		case 'Draft':
			return __('Change Request Draft');
		case 'In Review':
			return __('In Review');
		case 'Changes Requested':
			return __('Changes Requested');
		case 'Approved':
			return __('Approved');
		case 'Merged':
			return __('Merged');
		default:
			return __('Change Request');
	}
});

const bannerDescription = computed(() => {
	switch (props.changeRequestStatus) {
		case 'Draft':
			return __('Your changes are saved as a draft change request');
		case 'In Review':
			return __('Your change request is being reviewed');
		case 'Changes Requested':
			return __('Please review the feedback and update your changes');
		case 'Approved':
			return __('Approved and ready to merge');
		case 'Merged':
			return __('Your changes have been merged');
		default:
			return '';
	}
});
</script>
