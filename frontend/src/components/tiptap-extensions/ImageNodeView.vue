<template>
    <NodeViewWrapper class="wiki-image-wrapper my-2">
        <div
            class="max-w-full"
            :class="alignClass"
            :style="{ width: frameWidth ? `${frameWidth}px` : 'fit-content' }"
        >
            <div
                class="relative isolate overflow-hidden rounded-4"
                :class="{ 'ring-2 ring-outline-gray-3 ring-offset-2 ring-offset-[var(--surface-base)]': selected }"
            >
                <img
                    ref="imageRef"
                    :src="displayedSrc"
                    :alt="node.attrs.alt || ''"
                    :title="node.attrs.title || ''"
                    class="wiki-image block rounded-4"
                    :class="[frameWidth ? 'w-full' : 'max-w-full', { 'brightness-75': isUploading }]"
                    @click="selectNode"
                />
                <div
                    v-if="isEditable && hasFile && (selected || menuOpen)"
                    class="absolute right-2.5 top-2.5 z-20"
                >
                    <Dropdown v-model:open="menuOpen" :options="menuOptions" align="end">
                        <template #trigger>
                            <button
                                type="button"
                                :class="CHROME_BUTTON"
                                aria-label="Image options"
                                @click.stop
                                @pointerdown.stop
                            >
                                <span class="lucide-ellipsis size-4" aria-hidden="true" />
                            </button>
                        </template>
                    </Dropdown>
                </div>
                <button
                    v-if="isEditable && hasFile && selected"
                    type="button"
                    :class="[CHROME_BUTTON, 'absolute bottom-2.5 right-2.5 z-30 cursor-nwse-resize touch-none']"
                    aria-label="Resize image"
                    @pointerdown.prevent.stop="startResize"
                    @keydown="resizeWithKeys"
                >
                    <span class="lucide-move-diagonal-2 size-4" aria-hidden="true" />
                </button>
                <input
                    v-if="canReplace"
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="uploadSelectedFile"
                />
                <div
                    v-if="isUploading"
                    class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 text-sm text-white"
                >
                    <LoadingIndicator class="size-5" />
                    <span>Uploading…</span>
                </div>
            </div>
            <div v-if="node.attrs.error" class="wiki-image-error py-2 text-center text-sm text-ink-red-4">
                Upload failed: {{ node.attrs.error }}
            </div>
            <input
                v-else-if="isEditable && showCaption"
                ref="captionInput"
                v-model="caption"
                type="text"
                draggable="false"
                class="h-7 w-full border-none bg-transparent text-center text-sm italic text-ink-gray-6 placeholder-ink-gray-4 focus:ring-0"
                placeholder="Add a caption"
                aria-label="Caption"
                @input="updateCaption"
                @keydown="handleKeydown"
            />
            <div
                v-else-if="!isEditable && node.attrs.caption"
                class="px-1 pt-1 text-center text-sm italic text-ink-gray-6"
            >
                {{ node.attrs.caption }}
            </div>
        </div>
    </NodeViewWrapper>
</template>

<script setup>
import { useNodeViewEditable } from '@/composables/useNodeViewEditable';
import { useTheme } from '@/composables/useTheme';
import { NodeViewWrapper } from '@tiptap/vue-3';
import { Dropdown, LoadingIndicator } from 'frappe-ui';
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue';

const CHROME_BUTTON =
	'flex size-7 items-center justify-center rounded-4 bg-black-overlay-300 text-white transition-colors hover:bg-black-overlay-400 active:bg-black-overlay-500 data-[state=open]:bg-black-overlay-500';
const MIN_WIDTH = 50;

const props = defineProps({
	node: {
		type: Object,
		required: true,
	},
	updateAttributes: {
		type: Function,
		required: true,
	},
	selected: {
		type: Boolean,
		default: false,
	},
	editor: {
		type: Object,
		required: true,
	},
	getPos: {
		type: Function,
		required: true,
	},
	extension: {
		type: Object,
		required: true,
	},
});

// The reactive proxy fails ProseMirror's "mismatched transaction" check.
const editor = toRaw(props.editor);
const isEditable = useNodeViewEditable(editor);
const { resolvedTheme } = useTheme();
const imageRef = ref(null);
const captionInput = ref(null);
const fileInput = ref(null);
const caption = ref(props.node.attrs.caption || '');
const replacingVariant = ref(null);
const isReplacing = ref(false);
const menuOpen = ref(false);
const dragWidth = ref(null);
// Only images added in this session have an uploadId.
const captionToggle = ref(props.node.attrs.uploadId ? true : null);

const isUploading = computed(
	() => props.node.attrs.loading || isReplacing.value,
);
const hasFile = computed(
	() => !!props.node.attrs.src && !isUploading.value && !props.node.attrs.error,
);
const frameWidth = computed(() => dragWidth.value ?? props.node.attrs.width);
const showCaption = computed(
	() => captionToggle.value ?? !!props.node.attrs.caption,
);

const alignClass = computed(
	() =>
		({ left: 'mr-auto', right: 'ml-auto' })[props.node.attrs.align] ||
		'mx-auto',
);

const displayedSrc = computed(() =>
	resolvedTheme.value === 'dark' && props.node.attrs.darkSrc
		? props.node.attrs.darkSrc
		: props.node.attrs.src,
);

const canReplace = computed(
	() => isEditable.value && !!props.extension.options.uploadImage,
);

const menuOptions = computed(() => [
	{
		group: 'caption',
		hideLabel: true,
		options: [
			{
				label: 'Caption',
				icon: 'lucide-captions',
				switch: true,
				switchValue: showCaption.value,
				onClick: toggleCaption,
			},
		],
	},
	{
		group: 'Align',
		options: [
			{ value: 'left', label: 'Left', icon: 'lucide-align-left' },
			{ value: 'center', label: 'Center', icon: 'lucide-align-center' },
			{ value: 'right', label: 'Right', icon: 'lucide-align-right' },
		].map(({ value, label, icon }) => ({
			label,
			icon,
			selected: (props.node.attrs.align || 'center') === value,
			onClick: () =>
				props.updateAttributes({ align: value === 'center' ? null : value }),
		})),
	},
	...(canReplace.value
		? [
				{
					group: 'replace',
					hideLabel: true,
					options: [{ label: 'Replace image', icon: 'lucide-refresh-cw', submenu: replaceOptions.value }],
				},
			]
		: []),
]);

const replaceOptions = computed(() => [
	{
		label: 'For both modes',
		icon: 'lucide-image',
		onClick: () => chooseFile('both'),
	},
	{
		label: 'For light mode',
		icon: 'lucide-sun',
		onClick: () => chooseFile('light'),
	},
	{
		label: 'For dark mode',
		icon: 'lucide-moon',
		onClick: () => chooseFile('dark'),
	},
	...(props.node.attrs.darkSrc
		? [
				{
					label: 'Remove dark mode image',
					icon: 'lucide-trash-2',
					onClick: () => props.updateAttributes({ darkSrc: null }),
				},
			]
		: []),
]);

function toggleCaption() {
	captionToggle.value = !showCaption.value;
	if (captionToggle.value) {
		nextTick(() => captionInput.value?.focus());
	} else if (props.node.attrs.caption) {
		caption.value = '';
		props.updateAttributes({ caption: null });
	}
}

function chooseFile(variant) {
	replacingVariant.value = variant;
	fileInput.value?.click();
}

async function uploadSelectedFile(event) {
	const file = event.target.files?.[0];
	event.target.value = '';
	if (!file) return;

	isReplacing.value = true;
	let url;
	try {
		url = await props.extension.options.uploadImage(file);
	} catch {
		// uploadImage already told the author; the image keeps its current file.
		return;
	} finally {
		isReplacing.value = false;
	}
	if (editor.isDestroyed) return;

	const attributes = {
		both: { src: url, darkSrc: null },
		light: { src: url },
		dark: { darkSrc: url },
	};
	props.updateAttributes(attributes[replacingVariant.value]);
}

function maxWidth() {
	return editor.view.dom.clientWidth;
}

function clampWidth(width) {
	return Math.round(Math.min(Math.max(width, MIN_WIDTH), maxWidth()));
}

let stopDragTracking = null;

function startResize(event) {
	selectNode();
	const startX = event.clientX;
	const startWidth = imageRef.value.offsetWidth;
	const onMove = (moveEvent) => {
		dragWidth.value = clampWidth(startWidth + moveEvent.clientX - startX);
	};
	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', stopResize);
	document.body.style.cursor = 'nwse-resize';
	stopDragTracking = () => {
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', stopResize);
		document.body.style.cursor = '';
	};
}

function stopResize() {
	stopDragTracking?.();
	if (dragWidth.value && !editor.isDestroyed) {
		props.updateAttributes({ width: dragWidth.value });
	}
	dragWidth.value = null;
}

onBeforeUnmount(() => stopDragTracking?.());

function resizeWithKeys(event) {
	const step = { ArrowLeft: -20, ArrowUp: -20, ArrowRight: 20, ArrowDown: 20 }[
		event.key
	];
	if (!step) return;
	event.preventDefault();
	props.updateAttributes({
		width: clampWidth(imageRef.value.offsetWidth + step),
	});
}

// Watch for external changes to caption attribute
watch(
	() => props.node.attrs.caption,
	(newCaption) => {
		if (newCaption !== caption.value) {
			caption.value = newCaption || '';
		}
	},
);

function updateCaption() {
	props.updateAttributes({ caption: caption.value });
}

function selectNode() {
	const pos = props.getPos();
	if (typeof pos === 'number') {
		editor.commands.setNodeSelection(pos);
	}
}

function handleKeydown(event) {
	const pos = props.getPos();
	if (typeof pos !== 'number') return;

	if (event.key === 'Enter') {
		event.preventDefault();
		// Insert paragraph after image and move cursor there
		const endPos = pos + props.node.nodeSize;
		editor
			.chain()
			.focus()
			.insertContentAt(endPos, { type: 'paragraph' })
			.setTextSelection(endPos + 1)
			.run();
	} else if (event.key === 'Escape' || event.key === 'ArrowDown') {
		event.preventDefault();
		// Move cursor after the image
		const endPos = pos + props.node.nodeSize;
		editor.chain().focus().setTextSelection(endPos).run();
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		// Move cursor before the image
		editor.chain().focus().setTextSelection(pos).run();
	} else if (event.key === 'Backspace' && !caption.value) {
		event.preventDefault();
		toggleCaption();
		selectNode();
	}
}
</script>

<style scoped>
.wiki-image-wrapper.ProseMirror-selectednode,
.wiki-image-wrapper:focus {
    outline: none;
}

.wiki-image {
    margin: 0;
    height: auto;
    cursor: pointer;
}
</style>
