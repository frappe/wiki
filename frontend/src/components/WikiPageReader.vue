<template>
	<!-- Same layout as WikiEditor, so the page does not shift on Edit. -->
	<div ref="containerRef" class="wiki-editor-container">
		<div>
			<EditorTableOfContents v-if="showTocStrip" :headings="toc" variant="strip" />
			<div class="relative" :class="showTocRail ? 'pr-60' : ''">
				<div class="mx-auto w-full max-w-3xl px-8">
					<slot name="title" />
					<div
						v-show="html != null"
						ref="contentRef"
						class="wiki-rendered prose prose-v3 max-w-none pt-6"
						data-testid="page-reader"
						@click="followLink"
						v-html="html"
					/>
					<div v-if="html == null" class="space-y-4 pt-6">
						<Skeleton class="h-4 w-3/4 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4" />
						<Skeleton class="h-4 w-5/6 rounded-4" />
						<Skeleton class="h-4 w-full rounded-4" />
						<Skeleton class="h-4 w-2/3 rounded-4" />
					</div>
				</div>
				<EditorTableOfContents v-if="showTocRail" :headings="toc" variant="rail" />
			</div>
		</div>
	</div>
</template>

<script setup>
import { useOutlineLayout } from '@/composables/useOutlineLayout';
import { SPACE_TREE_KEY, crumbRoute, trailToNode } from '@/lib/spaceTree';
import { Skeleton } from 'frappe-ui';
import {
	inject,
	nextTick,
	onBeforeUnmount,
	onMounted,
	useTemplateRef,
	watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { enhanceCodeBlocks } from '../../../wiki/public/js/code-blocks.js';
import { bindImageViewer } from '../../../wiki/public/js/image-viewer.js';
import { renderMermaid } from '../../../wiki/public/js/mermaid-renderer.js';
import { bindPdfEmbeds } from '../../../wiki/public/js/pdf-viewer.js';
import { bindThemeImages } from '../../../wiki/public/js/theme-images.js';
import EditorTableOfContents from './EditorTableOfContents.vue';
import { getMermaid } from './tiptap-extensions/mermaid-loader.js';

const props = defineProps({
	// null while loading.
	html: {
		type: String,
		default: null,
	},
	toc: {
		type: Array,
		default: () => [],
	},
	showOutline: {
		type: Boolean,
		default: true,
	},
});

const route = useRoute();
const router = useRouter();
const spaceTree = inject(SPACE_TREE_KEY, null);
const containerRef = useTemplateRef('containerRef');
const contentRef = useTemplateRef('contentRef');

const { showTocRail, showTocStrip } = useOutlineLayout(
	containerRef,
	() => props.showOutline,
);

let unbind = [];
onMounted(() => {
	const root = contentRef.value;
	unbind = [bindImageViewer(root), bindPdfEmbeds(root), bindThemeImages(root)];
});
onBeforeUnmount(() => {
	for (const stop of unbind) stop();
});

watch(
	() => props.html,
	async (html) => {
		if (!html) return;
		await nextTick();
		enhance(contentRef.value);
	},
	{ immediate: true },
);

async function enhance(root) {
	if (!root) return;
	renderMermaid(root, getMermaid);
	if (root.querySelector('pre > code')) {
		const { default: hljs } = await import('highlight.js/lib/common');
		enhanceCodeBlocks(root, hljs);
	}
}

// Page links point at the public reader. Keep them in the app and open
// other links in a new tab, like the editor.
function followLink(event) {
	const link = event.target.closest('a[href]');
	if (!link || event.defaultPrevented || event.button !== 0) return;
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	const href = link.getAttribute('href');
	if (href.startsWith('#')) {
		event.preventDefault();
		contentRef.value
			.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)
			?.scrollIntoView({ behavior: 'smooth' });
		return;
	}
	const url = new URL(link.href);
	if (!['http:', 'https:'].includes(url.protocol)) return;
	event.preventDefault();
	const target = pageRoute(url);
	if (target) router.push(target);
	else window.open(url.href, '_blank', 'noopener');
}

function pageRoute(url) {
	if (url.origin !== window.location.origin) return null;
	const path = decodeURIComponent(url.pathname).replace(/^\//, '');
	const node = trailToNode(
		spaceTree?.value?.children,
		(candidate) => !candidate.is_group && candidate.route === path,
	)?.at(-1);
	return node ? crumbRoute(node, route.params.spaceId) : null;
}
</script>
