<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingsRow
			:title="__('Space Name')"
			:description="__('Shown in the sidebar, the switcher and the reader header')"
		>
			<FormControl
				v-model="spaceName"
				class="w-64"
				type="text"
				:disabled="savingName"
				:placeholder="__('Space name')"
				@blur="saveSpaceName"
				@keydown.enter="$event.target.blur()"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Route Prefix')"
			:description="routeDescription"
		>
			<Button variant="outline" @click="$emit('open-update-routes')">
				{{ __('Update') }}
			</Button>
		</SettingsRow>

		<SettingsRow
			:title="__('Published')"
			:description="__('Make this wiki space publicly accessible')"
		>
			<Switch
				v-model="isPublished"
				:disabled="updatingPublishSetting"
				@update:modelValue="updatePublishSetting"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Space Logo')"
			:description="
				__('Shown in the reader header and on generated social preview images')
			"
		>
			<SpaceIdentityPicker
				:identity="space.doc || {}"
				:label="spaceName"
				@update="saveIdentity"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Clone Space')"
			:description="__('Create a new space with the same structure')"
		>
			<Button variant="outline" @click="$emit('open-clone')">
				{{ __('Clone') }}
			</Button>
		</SettingsRow>
	</div>
</template>

<script setup>
import { Button, FormControl, SettingsRow, Switch, toast } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

import SpaceIdentityPicker from '../SpaceIdentityPicker.vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
});

defineEmits(['open-update-routes', 'open-clone']);

const spaceName = ref('');
const savingName = ref(false);
const isPublished = ref(true);
const updatingPublishSetting = ref(false);

// Renaming the space never moves its pages — the route is changed on purpose,
// through the flow next to it, because every published URL depends on it.
const routeDescription = computed(() =>
	__('Pages live under /{0}/…', [props.space.doc?.route || '']),
);

watch(
	() => props.space.doc,
	(doc) => {
		if (doc) {
			spaceName.value = doc.space_name || '';
			isPublished.value = Boolean(doc.is_published);
		}
	},
	{ immediate: true },
);

// The picker only says what was chosen; a settings panel has no Save button,
// so the choice is written the moment it is made.
//
// Writes are chained rather than fired in parallel: each patch names all five
// identity fields, so two in flight at once can commit out of order and the
// slower one undoes the newer choice. A rejected save must not break the chain
// for the next one.
let saving = Promise.resolve();

function saveIdentity(patch) {
	saving = saving
		.then(() => props.space.setValue.submit(patch))
		.catch((error) => {
			toast.error(error.messages?.[0] || __('Failed to update the space logo'));
		});
}

async function updatePublishSetting(value) {
	updatingPublishSetting.value = true;
	try {
		await props.space.setValue.submit({ is_published: value ? 1 : 0 });
	} catch (error) {
		console.error('Failed to update publish setting:', error);
		isPublished.value = !value;
	} finally {
		updatingPublishSetting.value = false;
	}
}

async function saveSpaceName() {
	const saved = props.space.doc?.space_name || '';
	const next = spaceName.value.trim();
	// An empty name would leave the space unnamed everywhere it is listed.
	if (!next || next === saved) {
		spaceName.value = saved;
		return;
	}
	savingName.value = true;
	try {
		await props.space.setValue.submit({ space_name: next });
		spaceName.value = next;
	} catch (error) {
		spaceName.value = saved;
		toast.error(error.messages?.[0] || __('Failed to rename the space'));
	} finally {
		savingName.value = false;
	}
}
</script>
