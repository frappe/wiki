<template>
	<div class="flex flex-col h-full">
		<div class="flex items-center justify-between p-4 border-b border-outline-gray-2 bg-surface-white shrink-0">
			<div class="flex items-center gap-4">
				<Button variant="ghost" icon-left="arrow-left" @click="goBack">
					{{ __('Back to review') }}
				</Button>
				<div v-if="cr.doc">
					<div class="flex items-center gap-2">
						<h1 class="text-xl font-semibold text-ink-gray-9">{{ cr.doc.title }}</h1>
						<Badge variant="subtle" theme="blue" size="sm">{{ __('Preview') }}</Badge>
					</div>
					<p class="text-sm text-ink-gray-5 mt-0.5">
						{{ __('Rendered preview of the proposed pages — exactly as they will publish.') }}
					</p>
				</div>
			</div>
		</div>

		<div class="flex flex-1 overflow-hidden">
			<aside class="w-64 shrink-0 border-r border-outline-gray-2 overflow-auto py-3 bg-surface-gray-1">
				<div v-if="treeResource.loading" class="flex items-center justify-center py-8">
					<LoadingIndicator class="size-6" />
				</div>
				<ul v-else class="px-2 space-y-0.5">
					<li v-for="node in flatTree" :key="node.doc_key">
						<button
							class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-surface-gray-3"
							:class="node.doc_key === activeDocKey ? 'bg-surface-gray-3 font-medium text-ink-gray-9' : 'text-ink-gray-7'"
							:style="{ paddingLeft: `${0.5 + node.depth * 0.85}rem` }"
							@click="selectPage(node.doc_key)"
						>
							<component :is="node.is_group ? LucideFolder : LucideFileText" class="size-4 shrink-0 text-ink-gray-4" />
							<span class="truncate flex-1">{{ node.title || __('Untitled') }}</span>
							<span
								v-if="node.changeBadge"
								class="size-1.5 rounded-full shrink-0"
								:class="node.changeBadge"
								:title="node._changeType"
							/>
						</button>
					</li>
				</ul>
			</aside>

			<main class="flex-1 overflow-auto">
				<div class="max-w-3xl mx-auto px-6 py-8">
					<div v-if="previewResource.loading" class="flex items-center justify-center py-16">
						<LoadingIndicator class="size-8" />
					</div>
					<template v-else-if="currentPage">
						<h1 class="text-3xl font-semibold text-ink-gray-9 mb-6">{{ currentPage.title }}</h1>
						<div v-if="currentPage.is_group && !currentPage.rendered_content" class="text-ink-gray-5">
							{{ __('This is a group with no content of its own.') }}
						</div>
						<div v-else class="wiki-rendered prose prose-sm max-w-none" v-html="currentPage.rendered_content" />
					</template>
					<div v-else class="text-center text-ink-gray-5 py-16">
						{{ __('Select a page from the left to preview it.') }}
					</div>
				</div>
			</main>
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { createDocumentResource, createResource, Badge, Button, LoadingIndicator, toast, usePageMeta } from 'frappe-ui';
import LucideFolder from '~icons/lucide/folder';
import LucideFileText from '~icons/lucide/file-text';

const props = defineProps({
	changeRequestId: { type: String, required: true },
	docKey: { type: String, default: '' },
});

const router = useRouter();

const cr = createDocumentResource({
	doctype: 'Wiki Change Request',
	name: props.changeRequestId,
	auto: true,
});

usePageMeta(() => {
	if (!cr.doc) return;
	return { title: `${__('Preview')}: ${cr.doc.title} | Frappe Wiki` };
});

const treeResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
	params: { name: props.changeRequestId },
	auto: true,
});

const previewResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_preview_context',
});

const currentPage = ref(null);

// The proposed tree, flattened depth-first into a navigable list. Groups stay
// in place as headers; any node with content is selectable.
const changeBadgeClass = {
	added: 'bg-green-500',
	modified: 'bg-amber-500',
	deleted: 'bg-red-500',
};

const flatTree = computed(() => {
	const out = [];
	const walk = (nodes, depth) => {
		for (const node of nodes || []) {
			out.push({
				doc_key: node.doc_key,
				title: node.title,
				is_group: node.is_group,
				_changeType: node._changeType,
				changeBadge: changeBadgeClass[node._changeType] || '',
				depth,
			});
			if (node.children?.length) walk(node.children, depth + 1);
		}
	};
	walk(treeResource.data?.children, 0);
	return out;
});

const firstPageKey = computed(() => flatTree.value.find((n) => !n.is_group)?.doc_key || flatTree.value[0]?.doc_key || '');

const activeDocKey = computed(() => props.docKey || firstPageKey.value);

async function loadPage(docKey) {
	if (!docKey) {
		currentPage.value = null;
		return;
	}
	try {
		currentPage.value = await previewResource.submit({ name: props.changeRequestId, doc_key: docKey });
	} catch (error) {
		currentPage.value = null;
		toast.error(error.messages?.[0] || __('Could not render this page'));
	}
}

watch(activeDocKey, (docKey) => loadPage(docKey), { immediate: true });

function selectPage(docKey) {
	if (docKey === props.docKey) return;
	// Replace, not push: flipping between previewed pages is a filter, not a
	// navigation step, so Back should still return to the review (not walk back
	// through every page that was previewed).
	router.replace({ name: 'ChangeRequestPreview', params: { changeRequestId: props.changeRequestId, docKey } });
}

// Pop history so we land back on the review we came from; this is what stops the
// review<->preview back-button loop. Fall back to the review route if the
// preview was opened directly (no in-app history).
function goBack() {
	if (window.history.state?.back) {
		router.back();
	} else {
		router.push({ name: 'ChangeRequestReview', params: { changeRequestId: props.changeRequestId } });
	}
}
</script>
