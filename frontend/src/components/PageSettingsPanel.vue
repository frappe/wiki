<template>
	<!-- The page's own settings, alongside the page rather than on top of it:
	     the fields here describe what is on screen, and the social preview is
	     worth watching while the meta fields change. -->
	<aside
		class="flex h-full w-[352px] shrink-0 flex-col border-l border-outline-gray-2"
		data-testid="page-settings-panel"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-2 px-3"
		>
			<span class="truncate text-base-medium text-ink-gray-8">
				{{ __('Page settings') }}
			</span>
			<Button
				variant="ghost"
				:title="__('Close page settings')"
				:aria-label="__('Close page settings')"
				@click="emit('close')"
			>
				<span class="lucide-x size-4" aria-hidden="true" />
			</Button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto p-3">
			<div class="flex flex-col gap-6">
				<!-- On a git-synced page the repo owns the title, the slug, the
				     route and whether the page ships: the next sync rewrites
				     anything typed here. The social preview below is wiki-side
				     data the repo never carries, so it stays editable. -->
				<section class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between gap-2">
						<h4 class="text-xs text-ink-gray-5">{{ __('General') }}</h4>
						<Badge v-if="readonly" variant="subtle" theme="gray" size="sm">
							{{ __('From the repo') }}
						</Badge>
					</div>
					<FormControl
						v-model="form.title"
						type="text"
						:label="__('Title')"
						:placeholder="__('Untitled')"
						:disabled="readonly"
					/>
					<FormControl
						v-model="form.slug"
						type="text"
						:label="__('Slug')"
						:placeholder="__('page-slug')"
						:disabled="readonly"
					/>
					<FormControl
						v-model="form.route"
						type="text"
						:label="__('Route')"
						:placeholder="__('space/section/page')"
						:description="publicUrl"
						:disabled="readonly"
					/>
					<div class="flex items-center justify-between gap-3">
						<div class="flex flex-col">
							<span class="text-sm text-ink-gray-7">{{ __('Published') }}</span>
							<span class="text-xs text-ink-gray-5">
								{{ __('Visible on the public site') }}
							</span>
						</div>
						<Switch v-model="form.isPublished" :disabled="readonly" />
					</div>
				</section>

				<section class="flex flex-col gap-3">
					<h4 class="text-xs text-ink-gray-5">{{ __('Social preview') }}</h4>
					<FormControl
						v-model="form.metaTitle"
						type="text"
						:label="__('Meta title')"
						:placeholder="title"
						:description="__('Leave empty to use the page title')"
					/>
					<FormControl
						v-model="form.metaDescription"
						type="textarea"
						:label="__('Meta description')"
						:rows="3"
						:placeholder="__('A short summary shown in search results and link previews')"
						:description="descriptionHint"
					/>
					<div class="flex flex-col gap-1.5">
						<label class="text-sm text-ink-gray-5">{{ __('Meta image') }}</label>
						<div
							v-if="form.metaImage"
							class="group relative overflow-hidden rounded-5 border border-outline-gray-2"
						>
							<img :src="form.metaImage" alt="" class="aspect-[1200/630] w-full object-cover" />
							<div
								class="absolute inset-0 flex items-center justify-center gap-2 bg-black-overlay-400 opacity-0 transition-opacity group-hover:opacity-100"
							>
								<span
									v-if="isUploadingImage"
									class="lucide-loader-2 size-5 animate-spin text-white"
									aria-hidden="true"
								/>
								<template v-else>
									<Button size="sm" variant="solid" @click="pickImage">
										{{ __('Replace') }}
									</Button>
									<Button size="sm" variant="subtle" theme="red" @click="removeImage">
										{{ __('Remove') }}
									</Button>
								</template>
							</div>
						</div>
						<button
							v-else
							type="button"
							class="flex aspect-[1200/630] w-full flex-col items-center justify-center gap-1.5 rounded-5 border border-dashed border-outline-gray-3 bg-surface-gray-1 text-sm text-ink-gray-5 hover:bg-surface-gray-2"
							:disabled="isUploadingImage"
							@click="pickImage"
						>
							<span
								v-if="isUploadingImage"
								class="lucide-loader-2 size-5 animate-spin"
								aria-hidden="true"
							/>
							<span v-else class="lucide-image-plus size-5" aria-hidden="true" />
							<span>
								{{ isUploadingImage ? __('Uploading...') : __('Upload image') }}
							</span>
							<span class="text-xs text-ink-gray-4">
								{{ __('Recommended 1200×630') }}
							</span>
						</button>
						<input
							ref="imageInput"
							type="file"
							accept="image/*"
							class="hidden"
							@change="handleImageChange"
						/>
					</div>

					<div class="flex flex-col gap-2">
						<span class="text-sm text-ink-gray-5">{{ __('Preview') }}</span>
						<div class="flex flex-col overflow-hidden rounded-5 border border-outline-gray-2">
							<div
								class="relative flex aspect-[1200/630] w-full shrink-0 items-center justify-center bg-surface-gray-2"
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
								<span v-else class="lucide-image size-7 text-ink-gray-3" aria-hidden="true" />
								<!-- A cold card takes a Chromium launch to render, so the
								     placeholder icon would otherwise sit there looking like
								     "no image" for seconds. -->
								<div
									v-if="previewImage && previewImageLoading"
									class="absolute inset-0 animate-pulse bg-surface-gray-3"
								/>
							</div>
							<div class="flex flex-col gap-1 border-t border-outline-gray-2 p-3">
								<span class="truncate text-xs text-ink-gray-4">{{ route }}</span>
								<span class="line-clamp-1 text-sm-medium text-ink-gray-9">
									{{ form.metaTitle || title }}
								</span>
								<span
									v-if="form.metaDescription"
									class="line-clamp-3 text-xs leading-4 text-ink-gray-6"
								>
									{{ form.metaDescription }}
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
				</section>

				<section class="flex flex-col gap-2">
					<h4 class="text-xs text-ink-gray-5">{{ __('Details') }}</h4>
					<dl class="flex flex-col gap-2 text-sm">
						<div class="flex justify-between gap-3">
							<dt class="text-ink-gray-6">{{ __('Words') }}</dt>
							<dd class="text-ink-gray-8">{{ words }}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-ink-gray-6">{{ __('Reading time') }}</dt>
							<dd class="text-ink-gray-8">
								{{ __('{0} min', [readingTime]) }}
							</dd>
						</div>
						<div v-if="lastEdited" class="flex justify-between gap-3">
							<dt class="text-ink-gray-6">{{ __('Last edited') }}</dt>
							<dd class="text-ink-gray-8">{{ lastEdited }}</dd>
						</div>
						<div v-if="lastEditedBy" class="flex min-w-0 justify-between gap-3">
							<dt class="shrink-0 text-ink-gray-6">{{ __('Edited by') }}</dt>
							<dd class="truncate text-ink-gray-8">{{ lastEditedBy }}</dd>
						</div>
					</dl>
				</section>
			</div>
		</div>

		<div class="shrink-0 border-t border-outline-gray-2 p-3">
			<Button
				class="w-full"
				variant="solid"
				:disabled="!isDirty || isSaving"
				:loading="isSaving"
				@click="save"
			>
				{{ __('Save') }}
			</Button>
		</div>
	</aside>
</template>

<script setup>
import { countWords, readingMinutes } from '@/lib/readingStats';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import {
	Badge,
	Button,
	FormControl,
	Switch,
	dayjsLocal,
	toast,
	useFileUpload,
} from 'frappe-ui';
import { computed, reactive, ref, watch } from 'vue';

const props = defineProps({
	// The document resource WikiDocumentPanel already loaded. Meta fields are
	// written straight to the document (they carry no reader-visible content,
	// so they don't travel through a change request); the rest of the fields
	// go through the draft workspace.
	docResource: {
		type: Object,
		required: true,
	},
	docKey: {
		type: String,
		default: null,
	},
	// A git-synced page: the repo owns everything the change request would
	// carry, so only the meta fields are the wiki's to write.
	readonly: {
		type: Boolean,
		default: false,
	},
	// The effective values for the open page: the draft's, where it has one.
	title: {
		type: String,
		default: '',
	},
	slug: {
		type: String,
		default: '',
	},
	route: {
		type: String,
		default: '',
	},
	published: {
		type: Boolean,
		default: false,
	},
	// The editor's buffer, so the counts track what is on screen.
	content: {
		type: String,
		default: '',
	},
});

const emit = defineEmits(['close', 'node-updated']);

const draftStore = useDraftWorkspaceStore();
const fileUploader = useFileUpload();

const isSaving = ref(false);
const isUploadingImage = ref(false);
const imageInput = ref(null);

const form = reactive({
	title: '',
	slug: '',
	route: '',
	isPublished: false,
	metaTitle: '',
	metaDescription: '',
	metaImage: '',
});

// The saved values every field is measured against — the panel is a form, not
// a set of live controls, so nothing lands until Save.
const saved = computed(() => ({
	title: props.title || '',
	slug: props.slug || '',
	route: props.route || '',
	isPublished: Boolean(props.published),
	metaTitle: props.docResource.doc?.meta_title || '',
	metaDescription: props.docResource.doc?.meta_description || '',
	metaImage: props.docResource.doc?.meta_image || '',
}));

// The title is also edited in the prose column, and the tree renames pages
// behind the panel's back. Adopt an outside change only for a field the user
// has not touched: a field that already diverges from the old saved value is
// theirs until they save or the page changes.
watch(
	saved,
	(next, previous) => {
		for (const [field, value] of Object.entries(next)) {
			if (!previous || form[field] === previous[field]) form[field] = value;
		}
	},
	{ immediate: true },
);

const META_FIELDS = ['metaTitle', 'metaDescription', 'metaImage'];

const isDirty = computed(() =>
	Object.entries(saved.value).some(
		([field, value]) =>
			(!props.readonly || META_FIELDS.includes(field)) && form[field] !== value,
	),
);

const publicUrl = computed(() =>
	form.route ? `${window.location.origin}/${form.route}` : '',
);

const descriptionHint = computed(() =>
	__('Recommended: 150-160 characters ({0} so far)', [
		form.metaDescription.length,
	]),
);

const words = computed(() => countWords(props.content));
const readingTime = computed(() => readingMinutes(words.value));

const lastEdited = computed(() => {
	const modified = props.docResource.doc?.modified;
	return modified ? dayjsLocal(modified).fromNow() : '';
});
const lastEditedBy = computed(() => props.docResource.doc?.modified_by || '');

// With no uploaded image the page still ships an og:image — the generated card
// from wiki/api/og_image.py. Preview the real endpoint rather than a mock, so
// what this box shows is literally what a scraper will fetch. The endpoint 404s
// for every case that emits no card (setting off, unpublished, group, external
// link, no space, render failure), which is what the @error fallback catches.
// `v` is ignored server-side and exists only to force a refetch after a save
// that changed the card's inputs — bumping per save rather than per keystroke
// keeps it to one extra render instead of one per character typed.
const previewVersion = ref(0);
const previewImageFailed = ref(false);
const previewImageLoading = ref(true);

const generatedPreview = computed(() => {
	const route = props.docResource.doc?.route;
	if (!route) return '';
	return `/api/method/wiki.api.og_image.og_image?route=${encodeURIComponent(
		route,
	)}&v=${previewVersion.value}`;
});

const previewImage = computed(() => {
	if (form.metaImage) return form.metaImage;
	return previewImageFailed.value ? '' : generatedPreview.value;
});

// Every new URL is a fresh load, so the skeleton comes back until it decodes.
watch(previewImage, (url) => {
	previewImageLoading.value = Boolean(url);
});

const isGeneratedPreview = computed(
	() => !form.metaImage && Boolean(previewImage.value),
);

// A page switch discards whatever was typed: the fields describe a page, and
// carrying them across would rename the one you just opened. Declared after
// the `saved` watcher so it wins the same flush.
watch(
	() => props.docKey,
	() => {
		Object.assign(form, saved.value);
		previewImageFailed.value = false;
		previewImageLoading.value = true;
	},
);

function pickImage() {
	imageInput.value?.click();
}

function removeImage() {
	form.metaImage = '';
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
		form.metaImage = result.file_url;
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to upload image'));
	} finally {
		isUploadingImage.value = false;
	}
}

// The identifying fields are only ever changed, never cleared: an empty title
// or route would leave the page unreachable, and the backend would take it.
function nodeChanges() {
	const changes = {};
	// The repo is the source for all of these; a change request cannot carry
	// them, and the panel's inputs are disabled anyway.
	if (props.readonly) return changes;
	const current = saved.value;
	if (form.title.trim() && form.title !== current.title) {
		changes.title = form.title.trim();
	}
	if (form.slug.trim() && form.slug !== current.slug) {
		changes.slug = form.slug.trim();
	}
	const route = form.route.trim().replace(/^\/+/, '');
	if (route && route !== current.route) changes.route = route;
	if (form.isPublished !== current.isPublished) {
		changes.is_published = form.isPublished ? 1 : 0;
	}
	return changes;
}

function metaChanges() {
	const changes = {};
	const current = saved.value;
	if (form.metaTitle !== current.metaTitle) changes.meta_title = form.metaTitle;
	if (form.metaDescription !== current.metaDescription) {
		changes.meta_description = form.metaDescription;
	}
	if (form.metaImage !== current.metaImage) changes.meta_image = form.metaImage;
	return changes;
}

async function save() {
	const node = nodeChanges();
	const meta = metaChanges();
	isSaving.value = true;
	try {
		if (Object.keys(node).length) {
			if (!props.docKey) throw new Error(__('No active change request'));
			await draftStore.updateNode(props.docKey, node);
			emit('node-updated');
		}
		if (Object.keys(meta).length) {
			await props.docResource.setValue.submit(meta);
		}
		toast.success(__('Page settings saved'));
		// Retry a preview that failed before this save fixed its inputs.
		previewImageFailed.value = false;
		previewVersion.value += 1;
	} catch (error) {
		toast.error(
			error.messages?.[0] || error.message || __('Error saving page settings'),
		);
	} finally {
		isSaving.value = false;
	}
}
</script>
