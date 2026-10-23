<template>
	<div
		class="flex min-h-10 shrink-0 items-center gap-2 border-b border-outline-amber-2 bg-surface-amber-1 px-3 py-1 text-sm text-ink-amber-7 sm:px-5"
		role="status"
		data-testid="page-change-requests-notice"
	>
		<span class="lucide-git-pull-request size-4 shrink-0" aria-hidden="true" />
		<span class="min-w-0 flex-1">{{ message }}</span>
		<Dropdown :options="options" placement="right">
			<Button size="sm" variant="ghost">
				{{ __('View') }}
				<template #suffix>
					<span class="lucide-chevron-down size-4" aria-hidden="true" />
				</template>
			</Button>
		</Dropdown>
	</div>
</template>

<script setup>
import { Button, Dropdown } from 'frappe-ui';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
	spaceId: { type: String, required: true },
	changeRequests: { type: Array, required: true },
});

const router = useRouter();

const message = computed(() =>
	props.changeRequests.length === 1
		? __('1 open change request changes this page')
		: __('{0} open change requests change this page', [
				props.changeRequests.length,
		  ]),
);

const options = computed(() =>
	props.changeRequests.map((changeRequest) => ({
		label: changeRequest.title,
		icon: 'lucide-git-pull-request',
		onClick: () =>
			router.push({
				name: 'SpaceChangeRequest',
				params: { spaceId: props.spaceId, changeRequestId: changeRequest.name },
			}),
	})),
);
</script>
