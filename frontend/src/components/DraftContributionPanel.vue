<template>
	<div class="h-full flex flex-col">
		<div v-if="crPage && crPage.doc_key === props.docKey" class="h-full flex flex-col">
			<div class="flex items-center justify-between p-6 pb-4 bg-surface-white shrink-0 border-b-2 border-b-gray-500/20">
				<div class="flex items-center gap-2 min-w-0 flex-1">
					<div class="flex flex-col gap-1 min-w-0 flex-1">
						<input
							type="text"
							v-model="editableTitle"
							class="text-2xl font-semibold text-ink-gray-9 bg-transparent border-none outline-none w-full focus:ring-0 p-0 placeholder:text-ink-gray-4"
							:placeholder="__('Page title')"
							@blur="saveTitleIfChanged"
							@keydown.enter="$event.target.blur()"
						/>
						<div
							class="flex items-center gap-1 text-sm text-ink-gray-5 cursor-pointer hover:text-ink-gray-7 group/route"
							@click="openRouteDialog"
						>
							<span class="font-mono truncate">/{{ crPage.route || '' }}</span>
							<LucidePencil class="size-3 shrink-0 opacity-0 group-hover/route:opacity-100" />
						</div>
						<div class="flex items-center gap-2 mt-1">
							<Badge variant="subtle" theme="blue" size="sm">
								{{ __('Draft') }}
							</Badge>
							<Badge v-if="crPage.is_group" variant="subtle" theme="gray" size="sm">
								{{ __('Group') }}
							</Badge>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<Button
						variant="solid"
						:loading="isSaving"
						@click="saveFromHeader"
					>
						<template #prefix>
							<LucideSave class="size-4" />
						</template>
						{{ __('Save') }}
					</Button>
					<Dropdown :options="menuOptions">
						<Button variant="outline">
							<LucideMoreVertical class="size-4" />
						</Button>
					</Dropdown>
				</div>
			</div>

			<div v-if="!crPage.is_group" class="flex-1 overflow-auto px-6 pb-6">
				<WikiEditor v-if="editorKey" :key="editorKey" ref="editorRef" :content="editorContent" :document-key="props.docKey" :saved-content="savedContent" @save="saveContent" @content-change="onEditorContentChange" @content-ready="onEditorContentReady" />
			</div>

			<div v-else class="flex-1 flex items-center justify-center text-ink-gray-5">
				<div class="text-center">
					<LucideFolder class="size-12 mx-auto mb-4 text-ink-gray-4" />
					<p>{{ __('This is a draft group.') }}</p>
					<p class="text-sm">{{ __('Groups organize pages but have no content.') }}</p>
				</div>
			</div>
		</div>

		<div v-else-if="!loadFailed" class="h-full flex flex-col animate-pulse">
			<div class="flex items-center justify-between p-6 pb-4 shrink-0 border-b-2 border-b-gray-500/20">
				<div class="flex items-center gap-2">
					<div class="h-7 w-48 rounded bg-surface-gray-3" />
					<div class="h-5 w-14 rounded-full bg-surface-gray-3" />
				</div>
				<div class="flex items-center gap-2">
					<div class="h-8 w-28 rounded bg-surface-gray-3" />
					<div class="size-8 rounded bg-surface-gray-3" />
				</div>
			</div>
			<div class="flex-1 px-6 pb-6 mt-4 space-y-4">
				<div class="h-4 w-3/4 rounded bg-surface-gray-3" />
				<div class="h-4 w-full rounded bg-surface-gray-3" />
				<div class="h-4 w-5/6 rounded bg-surface-gray-3" />
				<div class="h-4 w-full rounded bg-surface-gray-3" />
				<div class="h-4 w-2/3 rounded bg-surface-gray-3" />
				<div class="h-4 w-full rounded bg-surface-gray-3 mt-6" />
				<div class="h-4 w-4/5 rounded bg-surface-gray-3" />
				<div class="h-4 w-full rounded bg-surface-gray-3" />
			</div>
		</div>

		<div v-else class="h-full flex items-center justify-center text-ink-gray-5">
			<div class="text-center">
				<LucideAlertCircle class="size-12 mx-auto mb-4 text-ink-gray-4" />
				<p>{{ __('Draft not found') }}</p>
			</div>
		</div>
		<Dialog v-model="showRouteDialog" :options="{ size: 'sm' }">
			<template #body-title>
				<h3 class="text-xl font-semibold text-ink-gray-9">{{ __('Edit Route') }}</h3>
			</template>
			<template #body-content>
				<FormControl
					v-model="editableRoute"
					:label="__('Route')"
					type="text"
					:placeholder="__('page-route')"
				/>
			</template>
			<template #actions="{ close }">
				<div class="flex justify-end gap-2">
					<Button variant="outline" @click="close">{{ __('Cancel') }}</Button>
					<Button variant="solid" :loading="isSavingRoute" @click="saveRoute(close)">
						{{ __('Update') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<script setup>
import { useChangeRequestStore } from '@/stores/changeRequest';
import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import {
	Badge,
	Button,
	Dialog,
	Dropdown,
	FormControl,
	LoadingIndicator,
	getCachedDocumentResource,
	toast,
	usePageMeta,
} from 'frappe-ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import LucideAlertCircle from '~icons/lucide/alert-circle';
import LucideFolder from '~icons/lucide/folder';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucidePencil from '~icons/lucide/pencil';
import LucideSave from '~icons/lucide/save';
import WikiEditor from './WikiEditor.vue';

const props = defineProps({
	docKey: {
		type: String,
		required: true,
	},
	spaceId: {
		type: String,
		required: false,
	},
});

const emit = defineEmits(['refresh']);
const router = useRouter();
const editorRef = ref(null);
const editableTitle = ref('');
const editableRoute = ref('');
const showRouteDialog = ref(false);
const isSavingRoute = ref(false);

const crStore = useChangeRequestStore();
const draftStore = useDraftWorkspaceStore();

const crPage = ref(null);
// Becomes true only once we've confirmed the page genuinely doesn't exist,
// so the "Draft not found" state never flashes during a normal load/switch.
const loadFailed = ref(false);
// Guards against a slow response for a page we've already navigated away
// from overwriting the page the user is now looking at.
let loadToken = 0;

// Browser tab title: "{draft page} | {space}". Returning undefined while the
// draft is still loading keeps the previous title instead of flashing a blank one.
usePageMeta(() => {
	const title = crPage.value?.title;
	if (!title) return;
	const space = props.spaceId
		? getCachedDocumentResource('Wiki Space', props.spaceId)
		: null;
	return { title: [title, space?.doc?.space_name].filter(Boolean).join(' | ') };
});

// Read the page through the workspace store. Tmp pages live entirely on the
// client; the store returns them from pagesByKey without hitting the
// backend (which would 404 on a tmp_* key).
//
// Stale-while-revalidate: if we already have this page cached in the store
// (a tmp create, a prior visit, or unsaved local edits) we paint it
// synchronously so switching pages is instant. The skeleton is reserved for
// the cold case where nothing is cached yet. The background fetch then
// revalidates whatever we showed.
async function loadCrPage() {
	const docKey = props.docKey;
	const token = ++loadToken;
	if (!docKey) {
		crPage.value = null;
		loadFailed.value = false;
		return;
	}
	loadFailed.value = false;

	const cached = draftStore.pagesByKey[docKey];
	if (cached) setCrPageFromStore(docKey, cached);

	try {
		const page = await draftStore.loadCrPage(docKey);
		if (token !== loadToken) return; // superseded by a newer navigation
		if (page) {
			setCrPageFromStore(docKey, page);
		} else if (
			draftStore.crName &&
			!(crPage.value && crPage.value.doc_key === docKey)
		) {
			// We have a change request but the page resolved to nothing —
			// it's genuinely missing (deleted / bad URL), not still loading.
			crPage.value = null;
			loadFailed.value = true;
		}
	} catch (error) {
		if (token !== loadToken) return;
		console.error('Error loading draft page:', error);
		if (!(crPage.value && crPage.value.doc_key === docKey)) {
			crPage.value = null;
			loadFailed.value = true;
		}
	}
}

function setCrPageFromStore(docKey, page = draftStore.pagesByKey[docKey]) {
	if (!page) {
		crPage.value = null;
		return;
	}
	const node = draftStore.findNode(docKey);
	crPage.value = {
		doc_key: docKey,
		title: page.title,
		route: page.route,
		content: page.localContent ?? page.content,
		is_published: page.isPublished,
		is_group: node?.isGroup || false,
	};
}

onMounted(async () => {
	if (props.spaceId) {
		await draftStore.hydrate(props.spaceId);
	}
	await loadCrPage();
});

watch(
	() => props.docKey,
	async (newId) => {
		if (newId) {
			await loadCrPage();
		}
	},
);

function onEditorContentChange(content, docKey = props.docKey, options = {}) {
	if (!docKey) return;
	const title = draftStore.pagesByKey[docKey]?.title ?? editableTitle.value;
	draftStore.recordEditorContent(docKey, content, title, options);
}

function onEditorContentReady(content, savedContent, docKey = props.docKey) {
	if (!docKey) return;
	const title = draftStore.pagesByKey[docKey]?.title ?? editableTitle.value;
	draftStore.reconcileEditorContent(docKey, content, savedContent, title);
}

watch(
	() => props.spaceId,
	async (newSpaceId) => {
		if (newSpaceId) {
			crStore.currentChangeRequest = null;
			draftStore.reset();
			await draftStore.hydrate(newSpaceId);
			await loadCrPage();
		}
	},
);

// Once the create syncs, swap the URL from /draft/tmp_* to /draft/realKey.
// Without this the panel would stay on a temp key after sync, and any
// reload would 404 on get_cr_page.
watch(
	() => draftStore.tempKeyResolutions[props.docKey],
	(realKey) => {
		if (realKey && realKey !== props.docKey) {
			const currentContent = editorRef.value?.getMarkdown?.();
			if (currentContent !== undefined) {
				draftStore.updateLocalPageContent(
					realKey,
					currentContent,
					editableTitle.value,
				);
				draftStore
					.saveContent(realKey, currentContent, editableTitle.value)
					.catch((error) => {
						console.error('Error saving draft after create:', error);
						toast.error(
							error.messages?.[0] || error.message || __('Error saving draft'),
						);
					});
			}
			router.replace({
				name: 'DraftChangeRequest',
				params: { spaceId: props.spaceId, docKey: realKey },
			});
		}
	},
);

watch(
	crPage,
	(page) => {
		if (page) {
			editableTitle.value = page.title || '';
		}
	},
	{ immediate: true },
);

watch(
	() => draftStore.pagesByKey[props.docKey],
	(page) => {
		if (page) setCrPageFromStore(props.docKey, page);
	},
	{ deep: true },
);

const editorContent = computed(() => {
	return crPage.value?.content || '';
});

// Save state is owned by the workspace store.
const pageSaveStatus = computed(
	() => draftStore.pagesByKey[props.docKey]?.saveStatus || 'idle',
);
const isSaving = computed(() => pageSaveStatus.value === 'saving');
// The editor normalizes this confirmed snapshot before handing it back to
// the store for comparison.
const savedContent = computed(
	() => draftStore.pagesByKey[props.docKey]?.content ?? '',
);

const editorKey = computed(() => {
	if (crPage.value?.doc_key === props.docKey) {
		return `draft-${props.docKey}-${crPage.value?.doc_key}`;
	}
	return null;
});

const menuOptions = computed(() => {
	return [
		{
			label: __('Delete Draft'),
			icon: 'trash-2',
			onClick: deleteDraft,
		},
	];
});

async function saveTitleIfChanged() {
	const newTitle = editableTitle.value.trim();
	if (!newTitle || newTitle === (crPage.value?.title || '')) return;
	if (!crPage.value?.doc_key) return;
	try {
		await draftStore.updateNode(crPage.value.doc_key, { title: newTitle });
		await loadCrPage();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating title'));
	}
}

function openRouteDialog() {
	editableRoute.value = crPage.value?.route || '';
	showRouteDialog.value = true;
}

async function saveRoute(close) {
	const newRoute = editableRoute.value.trim().replace(/^\/+/, '');
	if (!newRoute || newRoute === (crPage.value?.route || '')) {
		close();
		return;
	}
	if (!crPage.value?.doc_key) return;
	isSavingRoute.value = true;
	try {
		await draftStore.updateNode(crPage.value.doc_key, { route: newRoute });
		await loadCrPage();
		close();
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating route'));
	} finally {
		isSavingRoute.value = false;
	}
}

function saveFromHeader() {
	editorRef.value?.saveToDB();
}

async function saveContent(content) {
	if (!crPage.value?.doc_key) return;
	try {
		await draftStore.saveContent(
			crPage.value.doc_key,
			content,
			editableTitle.value,
		);
	} catch (error) {
		console.error('Error saving draft:', error);
		// Inline failure UX comes in task #7; keep a toast for now so the
		// user isn't left wondering whether their save worked.
		toast.error(
			error.messages?.[0] || error.message || __('Error saving draft'),
		);
	}
}

async function deleteDraft() {
	if (!crPage.value?.doc_key) return;
	try {
		await draftStore.deleteNode(crPage.value.doc_key);
		router.push({ name: 'SpaceDetails', params: { spaceId: props.spaceId } });
	} catch (error) {
		console.error('Error deleting draft:', error);
		toast.error(error.messages?.[0] || __('Error deleting draft'));
	}
}
</script>
