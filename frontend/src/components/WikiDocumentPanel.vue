<template>
	<div class="h-full flex flex-col">
		<div v-if="wikiDoc.doc" class="h-full flex flex-col">
			<div class="flex items-center justify-between p-6 pb-4 bg-surface-white shrink-0 border-b-2 border-b-gray-500/20">
				<div class="flex items-center gap-2 min-w-0 flex-1">
					<div class="flex flex-col gap-1 min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<input
								type="text"
								v-model="editableTitle"
								class="text-2xl font-semibold text-ink-gray-9 bg-transparent border-none outline-none w-full focus:ring-0 p-0 placeholder:text-ink-gray-4"
								:placeholder="__('Page title')"
								@blur="saveTitleIfChanged"
								@keydown.enter="$event.target.blur()"
							/>
							<LucideLock v-if="wikiDoc.doc.is_private" class="size-4 text-ink-gray-5 shrink-0" :title="__('Private')" />
						</div>
						<div
							class="flex items-center gap-1 text-sm text-ink-gray-5 cursor-pointer hover:text-ink-gray-7 group/route"
							@click="openRouteDialog"
						>
							<span class="font-mono truncate">/{{ displayRoute }}</span>
							<LucidePencil class="size-3 shrink-0 opacity-0 group-hover/route:opacity-100" />
						</div>
						<div class="flex items-center gap-2 mt-1">
							<Badge v-if="displayPublished" variant="subtle" theme="green" size="sm">
								{{ __('Published') }}
							</Badge>
							<Badge v-else variant="subtle" theme="orange" size="sm">
								{{ __('Not Published') }}
							</Badge>
							<Badge v-if="hasChangeForCurrentPage" variant="subtle" theme="blue" size="sm">
								{{ __('Has Draft Changes') }}
							</Badge>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<Button
						v-if="wikiDoc.doc?.is_published"
						variant="outline"
						@click="openPage"
					>
						<template #prefix>
							<LucideExternalLink class="size-4" />
						</template>
						{{ __('View Page') }}
					</Button>
					<Button
						variant="solid"
						:loading="isSaving"
						@click="saveFromHeader"
					>
						<span class="flex items-center gap-2">
							{{ __('Save Draft') }}
							<kbd class="inline-flex items-center gap-1 rounded bg-white/25 px-1.5 py-0.5 text-[11px] font-medium opacity-80">
								<span class="text-sm">{{ isMac ? '⌘' : 'Ctrl+' }}</span><span>S</span>
							</kbd>
						</span>
					</Button>
					<Dropdown :options="menuOptions">
						<Button variant="outline">
							<LucideMoreVertical class="size-4" />
						</Button>
					</Dropdown>
				</div>
			</div>

			<div class="flex-1 overflow-auto px-6 pb-6 mt-4">
				<WikiEditor v-if="editorKey" :key="editorKey" ref="editorRef" :content="editorContent" :saving="isSaving" @save="saveContent" />
			</div>
		</div>

		<!-- Content skeleton -->
		<div v-else class="h-full flex flex-col animate-pulse">
			<div class="flex items-center justify-between p-6 pb-4 shrink-0 border-b-2 border-b-gray-500/20">
				<div class="flex items-center gap-2">
					<div class="h-7 w-48 rounded bg-surface-gray-3" />
					<div class="h-5 w-16 rounded-full bg-surface-gray-3" />
				</div>
				<div class="flex items-center gap-2">
					<div class="h-8 w-24 rounded bg-surface-gray-3" />
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
				<div class="h-4 w-3/4 rounded bg-surface-gray-3" />
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
import { ref, computed, watch } from 'vue';
import { createDocumentResource, Badge, Button, Dropdown, Dialog, FormControl, createResource, toast } from "frappe-ui";
import WikiEditor from './WikiEditor.vue';
import { useChangeRequestStore } from '@/stores/changeRequest';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucideLock from '~icons/lucide/lock';
import LucideExternalLink from '~icons/lucide/external-link';
import LucidePencil from '~icons/lucide/pencil';

const isMac = computed(() => /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));

const props = defineProps({
	pageId: {
		type: String,
		required: true
	},
	spaceId: {
		type: String,
		required: false
	}
});

const emit = defineEmits(['refresh']);
const editorRef = ref(null);
const editableTitle = ref('');
const editableRoute = ref('');
const showRouteDialog = ref(false);
const isSavingRoute = ref(false);

const crStore = useChangeRequestStore();

const wikiDoc = createDocumentResource({
	doctype: "Wiki Document",
	name: props.pageId,
	auto: true,
});

const crPageResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_page',
	onSuccess(data) {
		currentCrPage.value = data;
	},
});

const currentCrPage = ref(null);

watch(() => props.pageId, (newPageId) => {
	if (newPageId) {
		currentCrPage.value = null;
		wikiDoc.name = newPageId;
		wikiDoc.reload();
	}
});

watch(
	[() => crStore.currentChangeRequest?.name, () => wikiDoc.doc?.doc_key],
	async ([crName, docKey], [oldCrName]) => {
		if (crName && docKey) {
			await loadCrPage();
		} else {
			currentCrPage.value = null;
		}
		// After merge/archive, the CR name changes — reload wikiDoc to get updated route etc.
		if (oldCrName && crName !== oldCrName) {
			wikiDoc.reload();
		}
	},
	{ immediate: true },
);

async function loadCrPage() {
	if (!crStore.currentChangeRequest || !wikiDoc.doc?.doc_key) {
		currentCrPage.value = null;
		return;
	}
	await crPageResource.submit({
		name: crStore.currentChangeRequest.name,
		doc_key: wikiDoc.doc.doc_key,
	});
}

const hasChangeForCurrentPage = computed(() => {
	const docKey = wikiDoc.doc?.doc_key;
	if (!docKey) return false;
	return Boolean(crStore.changes.some((change) => change.doc_key === docKey));
});

const editorContent = computed(() => {
	if (currentCrPage.value?.content != null) {
		return currentCrPage.value.content;
	}
	return wikiDoc.doc?.content || '';
});

const displayTitle = computed(() => {
	return currentCrPage.value?.title || wikiDoc.doc?.title || '';
});

const displayPublished = computed(() => {
	if (currentCrPage.value?.is_published != null) {
		return Boolean(currentCrPage.value.is_published);
	}
	return Boolean(wikiDoc.doc?.is_published);
});

const displayRoute = computed(() => {
	return currentCrPage.value?.route || wikiDoc.doc?.route || '';
});

watch(displayTitle, (newTitle) => {
	editableTitle.value = newTitle;
}, { immediate: true });

const isSaving = computed(() => {
	return crStore.isUpdatingPage;
});

const editorKey = computed(() => {
	if (wikiDoc.doc?.name === props.pageId && !crPageResource.loading) {
		return props.pageId;
	}
	return null;
});

const menuOptions = computed(() => {
		return [
			{
			label: displayPublished.value ? __('Unpublish') : __('Publish'),
			icon: 'upload-cloud',
			onClick: togglePublish,
		},
	];
});

async function saveTitleIfChanged() {
	const newTitle = editableTitle.value.trim();
	if (!newTitle || newTitle === displayTitle.value) return;
	if (!crStore.currentChangeRequest || !wikiDoc.doc?.doc_key) return;
	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, wikiDoc.doc.doc_key, {
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
	editableRoute.value = displayRoute.value;
	showRouteDialog.value = true;
}

async function saveRoute(close) {
	const newRoute = editableRoute.value.trim().replace(/^\/+/, '');
	if (!newRoute || newRoute === displayRoute.value) {
		close();
		return;
	}
	if (!crStore.currentChangeRequest || !wikiDoc.doc?.doc_key) return;
	isSavingRoute.value = true;
	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, wikiDoc.doc.doc_key, {
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

async function togglePublish() {
	if (!crStore.currentChangeRequest || !wikiDoc.doc?.doc_key) return;
	const newStatus = displayPublished.value ? 0 : 1;
	const action = newStatus ? __('published') : __('unpublished');

	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, wikiDoc.doc.doc_key, {
			is_published: newStatus,
		});
		toast.success(__('Page {0}', [action]));
		await crStore.loadChanges();
		await loadCrPage();
		emit('refresh');
	} catch (error) {
		toast.error(error.messages?.[0] || __('Error updating publish status'));
	}
}

function openPage() {
	window.open(`/${wikiDoc.doc.route}`, '_blank');
}

function saveFromHeader() {
	editorRef.value?.saveToDB();
}

async function saveContent(content) {
	if (!crStore.currentChangeRequest || !wikiDoc.doc?.doc_key) {
		toast.error(__('No active change request'));
		return;
	}

	try {
		await crStore.updatePage(crStore.currentChangeRequest.name, wikiDoc.doc.doc_key, {
			content,
			title: editableTitle.value,
		});
		toast.success(__('Draft updated'));
		await crStore.loadChanges();
		emit('refresh');
	} catch (error) {
		console.error('Error saving change request:', error);
		toast.error(error.messages?.[0] || __('Error saving draft'));
	}
}

</script>
