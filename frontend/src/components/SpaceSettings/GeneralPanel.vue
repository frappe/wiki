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
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-4 border border-outline-gray-2 bg-surface-gray-1"
				>
					<img
						v-if="logo"
						:src="logo"
						alt=""
						class="h-full w-full object-contain"
					/>
					<span
						v-else
						class="lucide-image size-4 text-ink-gray-4"
						aria-hidden="true"
					/>
				</div>
				<Button variant="outline" :loading="uploadingLogo" @click="pickLogo">
					{{ logo ? __('Replace') : __('Upload') }}
				</Button>
				<Button v-if="logo" variant="ghost" theme="red" @click="removeLogo">
					{{ __('Remove') }}
				</Button>
				<input
					ref="logoInput"
					type="file"
					accept="image/*"
					class="hidden"
					@change="handleLogoChange"
				/>
			</div>
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
import {
	Button,
	FormControl,
	SettingsRow,
	Switch,
	toast,
	useFileUpload,
} from 'frappe-ui';
import { computed, ref, watch } from 'vue';

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

const logo = ref('');
const uploadingLogo = ref(false);
const logoInput = ref(null);
const fileUploader = useFileUpload();

watch(
	() => props.space.doc,
	(doc) => {
		if (doc) {
			spaceName.value = doc.space_name || '';
			isPublished.value = Boolean(doc.is_published);
			logo.value = doc.app_switcher_logo || '';
		}
	},
	{ immediate: true },
);

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

function pickLogo() {
	logoInput.value?.click();
}

async function saveLogo(fileUrl) {
	const previous = logo.value;
	logo.value = fileUrl;
	try {
		await props.space.setValue.submit({ app_switcher_logo: fileUrl });
	} catch (error) {
		logo.value = previous;
		toast.error(error.messages?.[0] || __('Failed to update logo'));
	}
}

function removeLogo() {
	saveLogo('');
}

async function handleLogoChange(event) {
	const file = event.target.files?.[0];
	// Reset the input so re-selecting the same file still fires `change`.
	event.target.value = '';
	if (!file) return;

	uploadingLogo.value = true;
	try {
		const result = await fileUploader.upload(file, {
			// Public: the reader header and the OG card are both anonymous
			// surfaces, and the card renderer cannot read /private/files.
			private: false,
			upload_endpoint: '/api/method/wiki.api.upload_wiki_asset',
		});
		await saveLogo(result.file_url);
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to upload logo'));
	} finally {
		uploadingLogo.value = false;
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
