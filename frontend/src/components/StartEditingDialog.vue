<template>
	<Dialog v-model:open="open" @after-leave="settle(started)">
		<template #title>
			<h3 class="text-2xl-semibold text-ink-gray-9">
				{{ __('New change request') }}
			</h3>
		</template>
		<template #default>
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
import { useStartEditing } from '../composables/useStartEditing';
import { useSpaceStore } from '../stores/space';

const spaceStore = useSpaceStore();
const { request, settle } = useStartEditing();

const title = ref('');
const description = ref('');
const starting = ref(false);
const started = ref(false);
const isOpen = ref(false);

watch(request, (pending) => {
	if (!pending) return;
	title.value = '';
	description.value = '';
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
