<template>
	<Dialog v-model="show" :options="{ size: 'md' }">
		<template #body-title>
			<h3 class="text-xl font-semibold text-ink-gray-9">{{ __('Assign Reviewer') }}</h3>
		</template>
		<template #body-content>
			<div class="space-y-4">
				<p class="text-ink-gray-7">
					{{ __('Assign this change request to a reviewer. They will be notified and it will appear in their "Assigned to me" list.') }}
				</p>
				<Autocomplete
					v-model="selected"
					:options="userOptions"
					:placeholder="__('Search people...')"
					multiple
				/>
			</div>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end gap-2">
				<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
				<Button
					variant="solid"
					:loading="assignResource.loading"
					:disabled="!selected.length"
					@click="handleAssign(close)"
				>
					{{ __('Assign') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Autocomplete, Button, Dialog, createListResource, createResource, toast } from 'frappe-ui';

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	changeRequestId: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue', 'assigned']);

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit('update:modelValue', value),
});

const selected = ref([]);

const users = createListResource({
	doctype: 'User',
	fields: ['name', 'full_name'],
	filters: { enabled: 1, user_type: 'System User' },
	orderBy: 'full_name asc',
	pageLength: 500,
	auto: true,
});

const userOptions = computed(() =>
	(users.data || []).map((u) => ({
		label: u.full_name ? `${u.full_name} (${u.name})` : u.name,
		value: u.name,
	})),
);

const assignResource = createResource({
	url: 'frappe.desk.form.assign_to.add',
});

async function handleAssign(close) {
	const assignTo = selected.value.map((o) => o.value || o);
	if (!assignTo.length) return;
	try {
		await assignResource.submit({
			doctype: 'Wiki Change Request',
			name: props.changeRequestId,
			assign_to: assignTo,
		});
		toast.success(__('Reviewer assigned'));
		selected.value = [];
		close?.();
		emit('assigned');
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error assigning reviewer'));
	}
}
</script>
