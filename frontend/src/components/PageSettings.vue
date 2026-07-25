<template>
	<Dialog v-model:open="show" size="2xl">
		<template #title>
			<h3 class="text-2xl-semibold text-ink-gray-9">
				{{ __('Page Settings') }}
			</h3>
		</template>
		<template #default>
			<div class="flex flex-col gap-5 sm:flex-row">
				<div class="flex flex-1 flex-col gap-4">
					<FormControl
						type="text"
						:label="__('Meta Title')"
						v-model="metaTitle"
						:placeholder="currentTitle"
						:description="__('Leave empty to use the page title')"
					/>
					<FormControl
						type="textarea"
						:label="__('Meta Description')"
						v-model="metaDescription"
						:placeholder="__('A short summary shown in search results and link previews')"
						:rows="3"
						:description="descriptionHint"
					/>
					<div class="flex flex-col gap-1.5">
						<label class="text-sm text-ink-gray-5">
							{{ __('Meta Image') }}
						</label>
						<div
							v-if="metaImage"
							class="group relative overflow-hidden rounded-md border border-outline-gray-2"
						>
							<img :src="metaImage" alt="" class="h-32 w-full object-cover" />
							<div
								class="absolute inset-0 flex items-center justify-center gap-2 bg-black-overlay-400 opacity-0 transition-opacity group-hover:opacity-100"
							>
								<span
									v-if="isUploadingImage"
									class="lucide-loader-2 h-5 w-5 animate-spin text-white" aria-hidden="true" />
								<template v-else>
									<Button size="sm" variant="solid" @click="pickImage">
										{{ __('Replace') }}
									</Button>
									<Button
										size="sm"
										variant="subtle"
										theme="red"
										@click="removeImage"
									>
										{{ __('Remove') }}
									</Button>
								</template>
							</div>
						</div>
						<button
							v-else
							type="button"
							class="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-outline-gray-3 bg-surface-gray-1 py-6 text-sm text-ink-gray-5 hover:bg-surface-gray-2"
							:disabled="isUploadingImage"
							@click="pickImage"
						>
							<span
								v-if="isUploadingImage"
								class="lucide-loader-2 h-5 w-5 animate-spin" aria-hidden="true" />
							<span v-else class="lucide-image-plus h-5 w-5" aria-hidden="true" />
							<span>{{ isUploadingImage ? __('Uploading...') : __('Upload image') }}</span>
						</button>
						<p class="text-xs text-ink-gray-4">
							{{ __('Recommended size: 1200×630px') }}
						</p>
						<input
							ref="imageInput"
							type="file"
							accept="image/*"
							class="hidden"
							@change="handleImageChange"
						/>
					</div>
				</div>
				<div class="flex w-full flex-shrink-0 flex-col gap-2 sm:w-56">
					<span class="text-sm text-ink-gray-5">{{ __('Social Preview') }}</span>
					<div
						class="flex flex-col self-start w-full overflow-hidden rounded-md border border-outline-gray-2"
					>
						<div
							class="relative flex h-28 w-full flex-shrink-0 items-center justify-center bg-surface-gray-2"
						>
							<img
								v-if="previewImage"
								:src="previewImage"
								alt=""
								class="h-full w-full object-cover"
								:class="{ 'opacity-0': previewImageLoading }"
								@load="previewImageLoading = false"
								@error="previewImageFailed = true"
							/>
							<span
								v-else
								class="lucide-image h-7 w-7 text-ink-gray-3"
								aria-hidden="true"
							/>
							<!-- A cold card takes a Chromium launch to render, so the
							     placeholder icon would otherwise sit there looking like
							     "no image" for seconds. -->
							<div
								v-if="previewImage && previewImageLoading"
								class="absolute inset-0 animate-pulse bg-surface-gray-3"
							/>
						</div>
						<div class="flex flex-col gap-1 border-t border-outline-gray-2 p-3">
							<span class="truncate text-xs text-ink-gray-4">
								{{ previewRoute }}
							</span>
							<span class="line-clamp-1 text-sm-medium text-ink-gray-9">
								{{ previewTitle }}
							</span>
							<span
								v-if="previewDescription"
								class="line-clamp-3 text-xs leading-4 text-ink-gray-6"
							>
								{{ previewDescription }}
							</span>
							<span v-else class="text-xs italic leading-4 text-ink-gray-3">
								{{ __('No description set') }}
							</span>
						</div>
					</div>
					<p v-if="isGeneratedPreview" class="text-xs text-ink-gray-4">
						{{ __('Auto-generated from the page metadata. Upload an image to override it.') }}
					</p>
				</div>
			</div>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end gap-2">
				<Button variant="outline" @click="close">
					{{ __('Cancel') }}
				</Button>
				<Button
					variant="solid"
					:disabled="!isDirty || docResource.setValue.loading"
					:loading="docResource.setValue.loading"
					@click="saveSettings"
				>
					{{ __('Save') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Button, Dialog, FormControl, toast, useFileUpload } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

const props = defineProps({
	// The document resource from createDocumentResource({ doctype: 'Wiki
	// Document', name }) — already loaded by WikiDocumentPanel, reused here
	// so opening Page Settings doesn't trigger a second fetch of the doc.
	docResource: {
		type: Object,
		required: true,
	},
});

const show = defineModel({ type: Boolean, default: false });

const metaTitle = ref('');
const metaDescription = ref('');
const metaImage = ref('');
const isUploadingImage = ref(false);
const imageInput = ref(null);

const fileUploader = useFileUpload();

const currentTitle = computed(() => props.docResource.doc?.title || '');

const descriptionHint = computed(() => {
	return __('Recommended: 150-160 characters ({0} so far)', [
		metaDescription.value.length,
	]);
});

const previewRoute = computed(() => props.docResource.doc?.route || '');
const previewTitle = computed(() => metaTitle.value || currentTitle.value);
const previewDescription = computed(() => metaDescription.value);

// With no uploaded image the page still ships an og:image — the generated card
// from wiki/api/og_image.py. Preview the real endpoint rather than a mock, so
// what this box shows is literally what a scraper will fetch. The endpoint 404s
// for every case that emits no card (setting off, unpublished, group, external
// link, no space, render failure), which is what the @error fallback catches —
// no need to duplicate those conditions here.
// Bumped on each successful save. `v` is ignored server-side (the endpoint
// always recomputes the fingerprint) and exists only to force the browser to
// refetch — the img otherwise keeps whatever bytes it got, and a request that
// raced the save would leave a stale card on screen for the rest of the
// session. Bumping per *save* rather than per keystroke keeps it to one extra
// render, instead of launching Chromium on every character typed.
const previewVersion = ref(0);

const generatedPreview = computed(() => {
	const doc = props.docResource.doc;
	if (!doc?.route) return '';
	return `/api/method/wiki.api.og_image.og_image?route=${encodeURIComponent(
		doc.route,
	)}&v=${previewVersion.value}`;
});

const previewImageFailed = ref(false);
const previewImageLoading = ref(true);
const previewImage = computed(() => {
	if (metaImage.value) return metaImage.value;
	return previewImageFailed.value ? '' : generatedPreview.value;
});

// Every new URL is a fresh load, so the skeleton comes back until it decodes.
watch(previewImage, (url) => {
	previewImageLoading.value = Boolean(url);
});
const isGeneratedPreview = computed(
	() => !metaImage.value && Boolean(previewImage.value),
);

const isDirty = computed(() => {
	const doc = props.docResource.doc;
	if (!doc) return false;
	return (
		metaTitle.value !== (doc.meta_title || '') ||
		metaDescription.value !== (doc.meta_description || '') ||
		metaImage.value !== (doc.meta_image || '')
	);
});

// Reset form from the doc every time the dialog opens, so stale edits from a
// cancelled session never leak into the next open.
watch(show, (isOpen) => {
	if (!isOpen) return;
	const doc = props.docResource.doc;
	metaTitle.value = doc?.meta_title || '';
	metaDescription.value = doc?.meta_description || '';
	metaImage.value = doc?.meta_image || '';
	// Retry the generated card on each open; a render that failed once (cold
	// Chromium, another worker holding the lock) usually succeeds next time.
	previewImageFailed.value = false;
	previewImageLoading.value = true;
});

function pickImage() {
	imageInput.value?.click();
}

function removeImage() {
	metaImage.value = '';
}

async function handleImageChange(event) {
	const file = event.target.files?.[0];
	// Reset the input so re-selecting the same file still fires `change`.
	event.target.value = '';
	if (!file) return;

	isUploadingImage.value = true;
	try {
		const result = await fileUploader.upload(file, {
			private: false,
			// Hit our handler directly (not via upload_file's `method`
			// delegation, which would recurse). It converts PNG/JPEG to WebP
			// when the Wiki Setting is enabled, returning the optimized
			// file_url.
			upload_endpoint: '/api/method/wiki.api.upload_wiki_asset',
		});
		metaImage.value = result.file_url;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to upload image'));
	} finally {
		isUploadingImage.value = false;
	}
}

async function saveSettings() {
	try {
		await props.docResource.setValue.submit({
			meta_title: metaTitle.value,
			meta_description: metaDescription.value,
			meta_image: metaImage.value,
		});
		toast.success(__('Page settings saved'));
		// Retry a preview that failed before this save fixed its inputs.
		previewImageFailed.value = false;
		previewVersion.value += 1;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error saving page settings'));
	}
}
</script>
