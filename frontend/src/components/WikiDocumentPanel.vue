<template>
	<div class="h-full flex flex-col">
		<div v-if="wikiDoc.doc" class="h-full flex flex-col">
			<div class="flex items-center justify-between p-6 pb-4 bg-surface-white shrink-0 border-b-2 border-b-gray-500/20">
				<div class="flex items-center gap-2">
					<h1 class="text-2xl font-semibold text-ink-gray-9">{{ displayTitle }}</h1>
					<LucideLock v-if="wikiDoc.doc.is_private" class="size-4 text-ink-gray-5" :title="__('Private')" />
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
	</div>
</template>

<script setup>
import { ref, computed, watch, toRef, onMounted } from 'vue';
import { createDocumentResource, Badge, Button, Dropdown, createResource, toast } from "frappe-ui";
import WikiEditor from './WikiEditor.vue';
import { useChangeRequestMode, useChangeRequest, currentChangeRequest } from '@/composables/useChangeRequest';
import LucideMoreVertical from '~icons/lucide/more-vertical';
import LucideLock from '~icons/lucide/lock';
import LucideExternalLink from '~icons/lucide/external-link';

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

const spaceIdRef = toRef(props, 'spaceId');
const {
	initChangeRequest,
	loadChanges,
	changesResource,
} = useChangeRequestMode(spaceIdRef);

const {
	updatePage,
	updatePageResource,
} = useChangeRequest();

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

onMounted(async () => {
	if (props.spaceId) {
		await initChangeRequest();
		await loadChanges();
		await loadCrPage();
	}
});

watch(() => props.pageId, async (newPageId) => {
	if (newPageId) {
		wikiDoc.name = newPageId;
		wikiDoc.reload();
	}
});

watch(() => props.spaceId, async (newSpaceId) => {
	if (newSpaceId) {
		currentChangeRequest.value = null;
		await initChangeRequest();
		await loadChanges();
		await loadCrPage();
	}
});

watch(() => wikiDoc.doc?.doc_key, async () => {
	await loadCrPage();
});

watch(() => currentChangeRequest.value?.name, async () => {
	await loadCrPage();
});

async function loadCrPage() {
	if (!currentChangeRequest.value || !wikiDoc.doc?.doc_key) {
		return;
	}
	await crPageResource.submit({
		name: currentChangeRequest.value.name,
		doc_key: wikiDoc.doc.doc_key,
	});
}

const hasChangeForCurrentPage = computed(() => {
	const docKey = wikiDoc.doc?.doc_key;
	if (!docKey) return false;
	return Boolean(changesResource.data?.some((change) => change.doc_key === docKey));
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

const isSaving = computed(() => {
	return updatePageResource.loading;
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

async function togglePublish() {
	if (!currentChangeRequest.value || !wikiDoc.doc?.doc_key) return;
	const newStatus = displayPublished.value ? 0 : 1;
	const action = newStatus ? __('published') : __('unpublished');

	try {
		await updatePage(currentChangeRequest.value.name, wikiDoc.doc.doc_key, {
			is_published: newStatus,
		});
		toast.success(__('Page {0}', [action]));
		await loadChanges();
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
	if (!currentChangeRequest.value || !wikiDoc.doc?.doc_key) {
		toast.error(__('No active change request'));
		return;
	}

	try {
		await updatePage(currentChangeRequest.value.name, wikiDoc.doc.doc_key, {
			content,
			title: displayTitle.value,
		});
		toast.success(__('Draft updated'));
		await loadChanges();
		await loadCrPage();
		emit('refresh');
	} catch (error) {
		console.error('Error saving change request:', error);
		toast.error(error.messages?.[0] || __('Error saving draft'));
	}
}

</script>
