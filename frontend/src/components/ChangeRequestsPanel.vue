<template>
	<aside
		class="flex h-full w-[352px] shrink-0 flex-col border-l border-outline-gray-2"
		data-testid="change-requests-panel"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-2 px-3"
		>
			<span class="truncate text-base-medium text-ink-gray-8">
				{{ __('Change requests') }}
			</span>
			<Tooltip :text="__('Close change requests')">
				<Button
					variant="ghost"
					:aria-label="__('Close change requests')"
					@click="emit('close')"
				>
					<span class="lucide-x size-4" aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>

		<div class="px-3 pt-3">
			<TabButtons v-model="scope" :options="scopeOptions" fluid />
		</div>

		<ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pb-10 pt-2">
			<div
				v-if="!shown.length"
				class="flex flex-col items-center gap-2 px-4 py-16 text-center"
			>
				<div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
					<span class="lucide-git-pull-request size-6" aria-hidden="true" />
				</div>
				<p class="text-base text-ink-gray-7">
					{{ scope === 'page'
						? __('No open change requests on this page')
						: __('No open change requests') }}
				</p>
				<p v-if="scope === 'space'" class="text-p-sm text-ink-gray-5">
					{{ __('Submitted change requests in this space show up here.') }}
				</p>
			</div>
			<RouterLink
				v-for="changeRequest in shown"
				:key="changeRequest.name"
				:to="{
					name: 'SpaceChangeRequest',
					params: { spaceId, changeRequestId: changeRequest.name },
				}"
				class="flex items-start gap-2 rounded-4 px-2 py-1.5 hover:bg-surface-gray-2"
			>
				<Avatar
					:image="changeRequest.owner_image"
					:label="changeRequest.owner_name"
					:title="changeRequest.owner_name"
					size="sm"
					class="mt-0.5 shrink-0"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm-medium text-ink-gray-8">
						{{ changeRequest.title }}
					</p>
					<div class="mt-1 flex items-center gap-1.5">
						<Badge
							:label="changeRequest.status"
							:theme="statusTheme(changeRequest.status)"
							variant="subtle"
							size="sm"
						/>
						<span class="truncate text-xs text-ink-gray-5">
							{{ pageCount(changeRequest) }} ·
							{{ dayjsLocal(changeRequest.modified).fromNow() }}
						</span>
					</div>
				</div>
			</RouterLink>
		</ScrollArea>
	</aside>
</template>

<script setup>
import { statusTheme } from '@/lib/changeRequestStatus';
import {
	Avatar,
	Badge,
	Button,
	ScrollArea,
	TabButtons,
	Tooltip,
	dayjsLocal,
} from 'frappe-ui';
import { computed, ref } from 'vue';

const props = defineProps({
	spaceId: { type: String, required: true },
	changeRequests: { type: Array, required: true },
	docKey: { type: String, default: null },
});

const emit = defineEmits(['close']);

const pageChangeRequests = computed(() =>
	props.changeRequests.filter((changeRequest) =>
		changeRequest.changed_doc_keys.includes(props.docKey),
	),
);

const scopeOptions = [
	{ value: 'page', label: __('This page') },
	{ value: 'space', label: __('Space') },
];
const scope = ref('space');

const shown = computed(() =>
	scope.value === 'page' ? pageChangeRequests.value : props.changeRequests,
);

function pageCount(changeRequest) {
	const count = changeRequest.changed_doc_keys.length;
	return count === 1 ? __('1 page') : __('{0} pages', [count]);
}
</script>
