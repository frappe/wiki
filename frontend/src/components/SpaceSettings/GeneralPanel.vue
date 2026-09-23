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

		<SettingsRow
			v-if="spaceStore.canDeleteSpace"
			:title="__('Delete Space')"
			:description="__('Permanently delete this space and all its pages')"
		>
			<Button variant="subtle" theme="red" @click="openDeleteDialog">
				{{ __('Delete') }}
			</Button>
		</SettingsRow>

		<Dialog v-model:open="showDeleteDialog">
			<template #title>
				<h3 class="truncate text-2xl-semibold text-ink-gray-9">
					{{ __('Delete Space {0}', [savedName]) }}
				</h3>
			</template>
			<template #default>
				<div class="space-y-4">
					<div class="space-y-2">
						<p class="text-p-base text-ink-gray-7">
							{{ __('This cannot be undone. Deleting the space also removes:') }}
						</p>
						<ul class="list-disc space-y-1 pl-5 text-p-sm text-ink-gray-5">
							<li>{{ pagesLabel }}</li>
							<li>{{ __('Their revision history') }}</li>
							<li>{{ __('Every change request') }}</li>
						</ul>
					</div>
					<FormControl
						v-model="confirmName"
						type="text"
						:placeholder="savedName"
					>
						<template #label>
							<span>{{ confirmLabel[0] }}</span>
							<Tooltip :text="__('Click to copy')">
								<button
									type="button"
									class="inline-flex h-6 items-center rounded-4 bg-surface-gray-2 px-1.5 text-xs-medium text-ink-gray-7 hover:bg-surface-gray-3"
									@click.prevent="copySpaceName"
								>
									{{ savedName }}
								</button>
							</Tooltip>
							<span>{{ confirmLabel[1] }}</span>
						</template>
					</FormControl>
				</div>
			</template>
			<template #actions>
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="showDeleteDialog = false">
						{{ __('Cancel') }}
					</Button>
					<Button
						variant="solid"
						theme="red"
						:disabled="confirmName.trim() !== savedName"
						:loading="space.delete.loading"
						@click="deleteSpace"
					>
						{{ __('Delete Space') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import {
	Button,
	createResource,
	Dialog,
	FormControl,
	SettingsRow,
	Switch,
	toast,
	Tooltip,
} from 'frappe-ui';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useSpaceIdentitySaver } from '../../composables/useSpaceIdentitySaver.js';
import { useSpaceSettings } from '../../composables/useSpaceSettings.js';
import { useSpaceStore } from '../../stores/space.js';
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
const showDeleteDialog = ref(false);
const confirmName = ref('');

const router = useRouter();
const spaceStore = useSpaceStore();
const { close: closeSettings } = useSpaceSettings();
const savedName = computed(() => props.space.doc?.space_name || '');
const confirmLabel = computed(() => __('Type {0} to confirm', []).split('{0}'));

const spaceStats = createResource({
	url: 'wiki.api.wiki_space.get_space_stats',
	makeParams: () => ({ spaces: [props.space.doc?.name] }),
});
const pagesLabel = computed(() => {
	const pages = spaceStats.data?.[props.space.doc?.name]?.pages;
	if (pages === undefined) return __('All its pages');
	return pages === 1 ? __('1 page') : __('{0} pages', [pages]);
});

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
const saveIdentity = useSpaceIdentitySaver(() => props.space);

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

function openDeleteDialog() {
	confirmName.value = '';
	showDeleteDialog.value = true;
	spaceStats.fetch();
}

async function copySpaceName() {
	try {
		await navigator.clipboard.writeText(savedName.value);
		toast.success(__('Space name copied'));
	} catch {
		toast.error(__('Could not copy the space name'));
	}
}

async function deleteSpace() {
	try {
		await props.space.delete.submit();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to delete the space'));
		return;
	}
	showDeleteDialog.value = false;
	closeSettings();
	router.push({ name: 'AllSpaces' });
}
</script>
