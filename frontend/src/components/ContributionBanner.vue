<template>
	<div
		v-if="crStore.isChangeRequestMode"
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
				v-if="crStore.changeCount > 0"
				class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer bg-gray-100 text-gray-700 hover:bg-gray-200"
				@click="showChangesDialog = true"
			>
				<LucideList class="size-3.5" />
				{{ crStore.changeCount }} {{ crStore.changeCount === 1 ? __('change') : __('changes') }}
			</button>

			<template v-if="changeRequestStatus === 'Draft' || changeRequestStatus === 'Changes Requested'">
				<Button
					v-if="canShowMerge"
					size="sm"
					:loading="crStore.isMerging"
					:disabled="mergeDisabled"
					:title="mergeButtonTitle"
					@click="$emit('merge')"
				>
					{{ __('Merge') }}
				</Button>
				<Button
					v-if="crStore.changeCount > 0"
					size="sm"
					:loading="crStore.isSubmitting"
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
					:loading="crStore.isMerging"
					:disabled="mergeDisabled"
					:title="mergeButtonTitle"
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
				:loading="crStore.isArchiving"
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
						v-for="change in crStore.changes"
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

					<div v-if="crStore.changes.length === 0" class="text-center py-8 text-ink-gray-5">
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
					{{ __('You have {0} pending {1}.', [crStore.changeCount, crStore.changeCount === 1 ? __('change') : __('changes')]) }}
				</p>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button
						variant="solid"
						:loading="crStore.isSubmitting"
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
import LucideList from '~icons/lucide/list';
import LucideFolder from '~icons/lucide/folder';
import LucideFileText from '~icons/lucide/file-text';
import LucideLink from '~icons/lucide/link';
import { useChangeTypeDisplay } from '@/composables/useChangeTypeDisplay';
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useUserStore } from '@/stores/user';

const { getChangeIcon, getChangeIconClass, getChangeTheme, getChangeLabel, getChangeDescription } = useChangeTypeDisplay();
const crStore = useChangeRequestStore();
const userStore = useUserStore();

const props = defineProps({
	mergeDisabled: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['submit', 'withdraw', 'merge']);

const changeRequestStatus = computed(() => crStore.currentChangeRequest?.status || 'Draft');

const showChangesDialog = ref(false);
const showSubmitConfirmDialog = ref(false);

function confirmSubmit(closeDialog) {
	closeDialog();
	emit('submit');
}

const canShowMerge = computed(() => {
	return userStore.isWikiManager && crStore.changeCount > 0;
});

const mergeButtonTitle = computed(() => {
	if (props.mergeDisabled) {
		return __('Please wait for reordering to finish before merging');
	}
	return '';
});

const canShowArchive = computed(() => {
	return crStore.changeCount > 0 && (changeRequestStatus.value === 'Draft' || changeRequestStatus.value === 'In Review' || changeRequestStatus.value === 'Changes Requested');
});

const BANNER_CONFIG = {
	Draft: {
		class: 'bg-blue-50 border-b border-blue-200 text-blue-800',
		icon: LucideGitBranch,
		title: __('Change Request Draft'),
		description: __('Your changes are saved as a draft change request'),
	},
	'In Review': {
		class: 'bg-amber-50 border-b border-amber-200 text-amber-800',
		icon: LucideClock,
		title: __('In Review'),
		description: __('Your change request is being reviewed'),
	},
	'Changes Requested': {
		class: 'bg-red-50 border-b border-red-200 text-red-800',
		icon: LucideXCircle,
		title: __('Changes Requested'),
		description: __('Please review the feedback and update your changes'),
	},
	Approved: {
		class: 'bg-green-50 border-b border-green-200 text-green-800',
		icon: LucideCheckCircle,
		title: __('Approved'),
		description: __('Approved and ready to merge'),
	},
	Merged: {
		class: 'bg-green-50 border-b border-green-200 text-green-800',
		icon: LucideCheckCircle,
		title: __('Merged'),
		description: __('Your changes have been merged'),
	},
};

const DEFAULT_BANNER = {
	class: 'bg-gray-50 border-b border-gray-200 text-gray-800',
	icon: LucideAlertCircle,
	title: __('Change Request'),
	description: '',
};

const bannerConfig = computed(() => BANNER_CONFIG[changeRequestStatus.value] || DEFAULT_BANNER);
const bannerClass = computed(() => bannerConfig.value.class);
const bannerIcon = computed(() => bannerConfig.value.icon);
const bannerTitle = computed(() => bannerConfig.value.title);
const bannerDescription = computed(() => bannerConfig.value.description);
</script>
