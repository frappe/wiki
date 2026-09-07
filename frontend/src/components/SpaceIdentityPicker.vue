<template>
	<Popover v-model:open="open" align="end">
		<!-- reka's PopoverTrigger wires the click, keyboard and aria itself, so
		     the button carries no handler of its own. -->
		<template #trigger>
			<button
				type="button"
				class="rounded-[6px] ring-outline-gray-3 hover:ring-2"
				:aria-label="__('Change space logo')"
				data-testid="space-identity-trigger"
			>
				<SpaceAvatar :space="chosen" :label="label" size="2xl" />
			</button>
		</template>

		<template #default>
			<div class="w-64 space-y-3 p-3">
				<!-- An upload and a generated mark are alternatives, not layers,
				     so the control that picks between them is a value control
				     and the panels follow — hence TabButtons rather than Tabs.
				     TabButtons declares `inheritAttrs: false`, so the testid
				     sits on a wrapper. -->
				<div data-testid="space-identity-tabs">
					<TabButtons v-model="mode" :options="MODE_OPTIONS" fluid />
				</div>

				<template v-if="mode === 'icon'">
					<!-- Swatches are the tile itself in each tint, so the row
					     doubles as a preview of the icon currently selected. -->
					<div class="flex items-center justify-between">
						<button
							v-for="swatch in SPACE_COLORS"
							:key="swatch"
							type="button"
							class="rounded-4 p-1 ring-inset hover:bg-surface-gray-2"
							:class="swatch === color ? 'ring-2 ring-outline-gray-3' : ''"
							:aria-label="swatch"
							:aria-pressed="swatch === color"
							@click="pickColor(swatch)"
						>
							<SpaceAvatar
								:space="{ space_icon: icon, space_color: swatch }"
								:label="label"
								size="lg"
							/>
						</button>
					</div>

					<!-- No wrapper surface: the grid's own bottom fade is drawn
					     `from-surface-elevation-2`, which is the panel. -->
					<div class="-mx-3">
						<IconGrid :model-value="icon" @select="pickIcon" />
					</div>

					<Button
						class="w-full"
						icon-left="lucide-shuffle"
						:label="__('Shuffle')"
						:loading="rolling"
						data-testid="space-identity-shuffle"
						@click="shuffle"
					/>
				</template>

				<template v-else>
					<div class="flex items-center gap-3">
						<SpaceAvatar
							:space="{ app_switcher_logo: logo }"
							:label="label"
							size="2xl"
						/>
						<Button
							class="flex-1"
							:label="logo ? __('Replace') : __('Upload')"
							:loading="uploading"
							data-testid="space-identity-upload"
							@click="pickFile"
						/>
					</div>

					<!-- A stored logo that some other mark is currently hiding is
					     still there; this is how it comes back without a
					     re-upload. -->
					<Button
						v-if="logo && mark.mode !== 'logo'"
						class="w-full"
						:label="__('Use this image')"
						@click="useLogo"
					/>
					<Button
						v-if="logo"
						class="w-full"
						theme="red"
						variant="ghost"
						:label="__('Remove')"
						@click="removeLogo"
					/>
					<p v-else class="text-p-sm text-ink-gray-5">
						{{ __('PNG or SVG, shown at a small size.') }}
					</p>

					<input
						ref="fileInput"
						type="file"
						accept="image/*"
						class="hidden"
						@change="handleFileChange"
					/>
				</template>
			</div>
		</template>
	</Popover>
</template>

<script setup>
import { Button, Popover, TabButtons, toast, useFileUpload } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

import { rollSpaceAvatar } from '../lib/spaceAvatar.js';
import {
	generatedIdentityPatch,
	resolveSpaceIdentity,
	SPACE_COLORS,
} from '../lib/spaceIdentity.js';
import IconGrid from './IconGrid.vue';
import SpaceAvatar from './SpaceAvatar.vue';

/**
 * A space's whole visual identity behind one square tile: an uploaded image,
 * or a curated lucide icon on a tinted square, or a generated abstract mark.
 *
 * The picker never writes anything itself. It emits the fields a choice
 * implies and the caller decides what that means — the settings panel saves
 * them at once, because a panel with no Save button must not hold an identity
 * hostage until the dialog closes, while the create dialog holds them until
 * the space exists.
 */
const props = defineProps({
	// The five identity fields as a space stores them, flat. A `useDoc` doc or
	// a plain object from a form both work.
	identity: { type: Object, default: () => ({}) },
	label: { type: String, default: '' },
});

const emit = defineEmits(['update']);

const MODE_OPTIONS = [
	{ label: __('Icon'), value: 'icon' },
	{ label: __('Upload'), value: 'upload' },
];

const open = ref(false);
const rolling = ref(false);
const uploading = ref(false);
const fileInput = ref(null);
const fileUploader = useFileUpload();

/**
 * What the user has chosen since the popover opened, over what the caller has.
 * Every patch is built from this rather than from `identity`: a caller that
 * saves asynchronously has not echoed the last choice back yet, so picking a
 * colour and then an icon would otherwise send an icon patch carrying the old
 * colour — and the colour patch, built when there was no icon, carries an
 * empty `space_icon` that lands last and wipes the icon.
 *
 * Dropped when the popover closes, so a change made anywhere else shows up.
 */
const pending = ref({});

const chosen = computed(() => ({ ...props.identity, ...pending.value }));
const mark = computed(() => resolveSpaceIdentity(chosen.value));
const logo = computed(() => chosen.value.app_switcher_logo || '');
const icon = computed(() => chosen.value.space_icon || '');
const color = computed(() => mark.value.color);

function choose(patch) {
	pending.value = { ...pending.value, ...patch };
	emit('update', patch);
}

watch(open, (isOpen) => {
	if (!isOpen) pending.value = {};
});

// The tile that is showing is the tab you land on. A space that has never been
// given a mark opens on Icon, which is the one that can produce one in a click.
const mode = ref(mark.value.mode === 'logo' ? 'upload' : 'icon');

watch(
	() => mark.value.mode,
	(next) => {
		mode.value = next === 'logo' ? 'upload' : 'icon';
	},
);

// Colour is a one-click tweak you may want to repeat, so only the icon — the
// choice that finishes the job — closes the popover.
function pickColor(swatch) {
	choose(generatedIdentityPatch({ icon: icon.value, color: swatch }));
}

function pickIcon(next) {
	choose(generatedIdentityPatch({ icon: next, color: color.value }));
	open.value = false;
}

/**
 * A failed roll — a style chunk that would not download, say — leaves whatever
 * mark is already on screen rather than clearing it, so a flaky network costs
 * the user a shuffle and not their choice.
 */
async function shuffle() {
	rolling.value = true;
	try {
		choose(generatedIdentityPatch({ avatar: await rollSpaceAvatar() }));
	} catch (error) {
		console.error('Could not generate a space mark', error);
		toast.error(__('Could not generate a logo'));
	} finally {
		rolling.value = false;
	}
}

function useLogo() {
	choose(generatedIdentityPatch({}));
	open.value = false;
}

function removeLogo() {
	choose({ app_switcher_logo: '' });
}

function pickFile() {
	fileInput.value?.click();
}

async function handleFileChange(event) {
	const file = event.target.files?.[0];
	// Reset the input so re-selecting the same file still fires `change`.
	event.target.value = '';
	if (!file) return;

	uploading.value = true;
	try {
		const result = await fileUploader.upload(file, {
			// Public: the reader header and the OG card are both anonymous
			// surfaces, and the card renderer cannot read /private/files.
			private: false,
			upload_endpoint: '/api/method/wiki.api.upload_wiki_asset',
		});
		// An upload is the one direction that clears: it is an explicit choice
		// of this image over whatever mark was generated before.
		choose({
			...generatedIdentityPatch({}),
			app_switcher_logo: result.file_url,
		});
		open.value = false;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to upload logo'));
	} finally {
		uploading.value = false;
	}
}
</script>
