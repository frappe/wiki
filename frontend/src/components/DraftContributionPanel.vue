<template>
	<div class="h-full flex flex-col">
		<div v-if="crPage" class="h-full flex flex-col">
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
						{{ __('Save Draft') }}
					</Button>
					<Dropdown :options="menuOptions">
						<Button variant="outline">
							<LucideMoreVertical class="size-4" />
						</Button>
					</Dropdown>
				</div>
			</div>

			<div v-if="!crPage.is_group" class="flex-1 overflow-auto px-6 pb-6">
				<WikiEditor v-if="editorKey" :key="editorKey" ref="editorRef" :content="editorContent" :saving="isSaving" @save="saveContent" />
			</div>

			<div v-else class="flex-1 flex items-center justify-center text-ink-gray-5">
				<div class="text-center">
					<LucideFolder class="size-12 mx-auto mb-4 text-ink-gray-4" />
					<p>{{ __('This is a draft group.') }}</p>
					<p class="text-sm">{{ __('Groups organize pages but have no content.') }}</p>
				</div>
			</div>
		</div>

		<div v-else-if="isLoading" class="h-full flex flex-col animate-pulse">
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
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { createResource, Badge, Button, Dropdown, Dialog, FormControl, toast, LoadingIndicator } from "frappe-ui";
import WikiEditor from './WikiEditor.vue';
import { useChangeRequestStore } from '@/stores/changeRequest';
import LucideSave from '~icons/lucide/save';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucideFolder from '~icons/lucide/folder';
import LucideAlertCircle from '~icons/lucide/alert-circle';
import LucidePencil from '~icons/lucide/pencil';

const props = defineProps({
	docKey: {
		type: String,
		required: true
	},
	spaceId: {
		type: String,
		required: false
	}
});

const emit = defineEmits(['refresh']);
const router = useRouter();
const editorRef = ref(null);
const editableTitle = ref('');
const editableRoute = ref('');
const showRouteDialog = ref(false);
const isSavingRoute = ref(false);

const crStore = useChangeRequestStore();

const crPage = ref(null);
const isLoading = ref(true);

const fetchCrPageResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_page',
});

async function loadCrPage() {
	if (!crStore.currentChangeRequest) {
		crPage.value = null;
		return;
	}
	isLoading.value = true;
	try {
		const result = await fetchCrPageResource.submit({
			name: crStore.currentChangeRequest.name,
			doc_key: props.docKey,
		});
		crPage.value = result;
	} catch (error) {
		console.error('Error loading draft page:', error);
		crPage.value = null;
	} finally {
		isLoading.value = false;
	}
}

onMounted(async () => {
	if (props.spaceId) {
		await crStore.initChangeRequest(props.spaceId);
		await crStore.loadChanges();
	}
	await loadCrPage();
});

watch(() => props.docKey, async (newId) => {
	if (newId) {
		await loadCrPage();
	}
});

watch(() => props.spaceId, async (newSpaceId) => {
	if (newSpaceId) {
		crStore.currentChangeRequest = null;
		await crStore.initChangeRequest(newSpaceId);
		await crStore.loadChanges();
		await loadCrPage();
	}
});

watch(crPage, (page) => {
	if (page) {
		editableTitle.value = page.title || '';
	}
}, { immediate: true });

const editorContent = computed(() => {
	return crPage.value?.content || '';
});

const isSaving = computed(() => {
	return crStore.isUpdatingPage;
});

const editorKey = computed(() => {
	if (crPage.value) {
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
	if (!crStore.currentChangeRequest || !crPage.value?.doc_key) return;
	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, crPage.value.doc_key, {
			title: newTitle,
		});
		await crStore.loadChanges();
		await loadCrPage();
		emit('refresh');
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
	if (!crStore.currentChangeRequest || !crPage.value?.doc_key) return;
	isSavingRoute.value = true;
	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, crPage.value.doc_key, {
			route: newRoute,
		});
		await crStore.loadChanges();
		await loadCrPage();
		emit('refresh');
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
	if (!crStore.currentChangeRequest || !crPage.value?.doc_key) return;
	try {
		await crStore.updatePage(
			crStore.currentChangeRequest.name,
			crPage.value.doc_key,
			{ content, title: editableTitle.value },
		);
		toast.success(__('Draft updated'));
		await crStore.loadChanges();
		emit('refresh');
	} catch (error) {
		console.error('Error saving draft:', error);
		toast.error(error.messages?.[0] || __('Error saving draft'));
	}
}

async function deleteDraft() {
	if (!crStore.currentChangeRequest || !crPage.value?.doc_key) return;
	try {
		await crStore.deletePage(crStore.currentChangeRequest.name, crPage.value.doc_key);
		toast.success(__('Draft deleted'));
		await crStore.loadChanges();
		emit('refresh');
		router.push({ name: 'SpaceDetails', params: { spaceId: props.spaceId } });
	} catch (error) {
		console.error('Error deleting draft:', error);
		toast.error(error.messages?.[0] || __('Error deleting draft'));
	}
}

</script>
