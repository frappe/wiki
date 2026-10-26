<template>
	<Dialog v-model:open="open" @after-leave="settle(started)">
		<template #title>
			<h3 class="text-2xl-semibold text-ink-gray-9">
				{{ __('New change request') }}
			</h3>
		</template>
		<template #default>
			<div
				v-if="pageChangeRequests.length"
				class="mb-4 rounded-4 border border-outline-amber-2 bg-surface-amber-1 p-3"
				data-testid="page-change-requests-warning"
			>
				<p class="text-p-sm text-ink-amber-7">{{ warning }}</p>
				<RouterLink
					v-for="changeRequest in pageChangeRequests"
					:key="changeRequest.name"
					:to="{
						name: 'SpaceChangeRequest',
						params: { spaceId: route.params.spaceId, changeRequestId: changeRequest.name },
					}"
					class="mt-2 flex items-center gap-2 text-sm text-ink-gray-8 hover:underline"
					@click="open = false"
				>
					<span class="lucide-git-pull-request size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
					<span class="truncate">{{ changeRequest.title }}</span>
					<span class="shrink-0 text-ink-gray-5">{{ changeRequest.owner_name }}</span>
				</RouterLink>
			</div>
			<form class="space-y-4" @submit.prevent="start">
				<FormControl
					v-model="title"
					:label="__('Title')"
					type="text"
					:placeholder="__('What are you changing?')"
					required
					autofocus
				/>
				<FormControl
					v-model="description"
					:label="__('Description')"
					type="textarea"
					:placeholder="__('Describe the change')"
					:rows="3"
				/>
			</form>
		</template>
		<template #actions>
			<div class="flex justify-end gap-2">
				<Button variant="outline" @click="open = false">{{ __('Cancel') }}</Button>
				<Button
					variant="solid"
					:loading="starting"
					:disabled="!title.trim()"
					@click="start"
				>
					{{ __('Start editing') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Button, Dialog, FormControl, toast } from 'frappe-ui';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useStartEditing } from '../composables/useStartEditing';
import { useSpaceStore } from '../stores/space';

const spaceStore = useSpaceStore();
const { request, settle } = useStartEditing();

const title = ref('');
const description = ref('');
const starting = ref(false);
const started = ref(false);
const isOpen = ref(false);
const pageChangeRequests = ref([]);
const route = useRoute();

const warning = computed(() =>
	pageChangeRequests.value.length === 1
		? __('1 open change request already changes this page')
		: __('{0} open change requests already change this page', [
				pageChangeRequests.value.length,
			]),
);

watch(request, (pending) => {
	if (!pending) return;
	title.value = '';
	description.value = '';
	pageChangeRequests.value = pending.changeRequests;
	started.value = false;
	isOpen.value = true;
});

const open = computed({
	get: () => isOpen.value,
	set: (value) => {
		if (!starting.value) isOpen.value = value;
	},
});

async function start() {
	const trimmed = title.value.trim();
	if (!trimmed || starting.value) return;
	starting.value = true;
	try {
		await spaceStore.startEditing({
			title: trimmed,
			description: description.value.trim() || null,
		});
		started.value = true;
		isOpen.value = false;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Could not start editing'));
	} finally {
		starting.value = false;
	}
}
</script>
