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

		<ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pb-10">
			<div
				v-if="!changeRequests.length"
				class="flex flex-col items-center gap-2 px-4 py-16 text-center"
			>
				<div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
					<span class="lucide-git-pull-request size-6" aria-hidden="true" />
				</div>
				<p class="text-base text-ink-gray-7">{{ __('No open change requests') }}</p>
				<p class="text-p-sm text-ink-gray-5">
					{{ __('Submitted change requests in this space show up here.') }}
				</p>
			</div>
			<section v-for="group in groups" :key="group.label" :aria-label="group.label">
				<h4 class="px-2 pb-1 pt-4 text-sm text-ink-gray-5">{{ group.label }}</h4>
				<RouterLink
					v-for="changeRequest in group.changeRequests"
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
			</section>
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
	Tooltip,
	dayjsLocal,
} from 'frappe-ui';
import { computed } from 'vue';

const props = defineProps({
	spaceId: { type: String, required: true },
	changeRequests: { type: Array, required: true },
	docKey: { type: String, default: null },
});

const emit = defineEmits(['close']);

const groups = computed(() => {
	const changesPage = (changeRequest) =>
		changeRequest.changed_doc_keys.includes(props.docKey);
	const thisPage = props.changeRequests.filter(changesPage);
	const elsewhere = props.changeRequests.filter(
		(changeRequest) => !changesPage(changeRequest),
	);
	return [
		{ label: __('Changing this page'), changeRequests: thisPage },
		{
			label: thisPage.length
				? __('Elsewhere in this space')
				: __('In this space'),
			changeRequests: elsewhere,
		},
	].filter((group) => group.changeRequests.length);
});

function pageCount(changeRequest) {
	const count = changeRequest.changed_doc_keys.length;
	return count === 1 ? __('1 page') : __('{0} pages', [count]);
}
</script>
