<template>
    <NodeViewWrapper class="wiki-image-wrapper" :class="{ 'is-selected': selected }">
        <div class="wiki-image-container">
            <div class="wiki-image-frame">
                <img
                    :src="displayedSrc"
                    :alt="node.attrs.alt || ''"
                    :title="node.attrs.title || ''"
                    :width="node.attrs.width || undefined"
                    :height="node.attrs.height || undefined"
                    class="wiki-image"
                    :class="{ 'is-loading': isUploading }"
                    @click="selectNode"
                />
                <Dropdown
                    v-if="canReplace && selected && !isUploading"
                    :options="replaceOptions"
                    align="end"
                >
                    <Button
                        variant="outline"
                        size="sm"
                        class="wiki-image-menu-button"
                        aria-label="Image options"
                        title="Image options"
                    >
                        <span class="lucide-more-horizontal size-3.5" aria-hidden="true" />
                    </Button>
                </Dropdown>
                <input
                    v-if="canReplace"
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="uploadSelectedFile"
                />
                <!-- Upload / optimization progress overlay -->
                <div v-if="isUploading" class="wiki-image-loading-overlay">
                    <span class="wiki-image-spinner" />
                    <span class="wiki-image-loading-text">Uploading…</span>
                </div>
            </div>
            <div v-if="node.attrs.error" class="wiki-image-error">
                Upload failed: {{ node.attrs.error }}
            </div>
            <input
                v-if="(isEditable || node.attrs.caption) && !node.attrs.error"
                ref="captionInput"
                v-model="caption"
                type="text"
                class="wiki-image-caption-input"
                :class="{ 'has-caption': !!caption }"
                placeholder="Add caption..."
                :disabled="!isEditable"
                @input="updateCaption"
                @keydown="handleKeydown"
            />
        </div>
    </NodeViewWrapper>
</template>

<script setup>
import { useNodeViewEditable } from '@/composables/useNodeViewEditable';
import { useTheme } from '@/composables/useTheme';
import { NodeViewWrapper } from '@tiptap/vue-3';
import { Button, Dropdown } from 'frappe-ui';
import { computed, ref, watch } from 'vue';

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

const isEditable = useNodeViewEditable(props.editor);
const { resolvedTheme } = useTheme();
const captionInput = ref(null);
const fileInput = ref(null);
const caption = ref(props.node.attrs.caption || '');
const replacingVariant = ref(null);
const isReplacing = ref(false);

const isUploading = computed(
	() => props.node.attrs.loading || isReplacing.value,
);

const displayedSrc = computed(() =>
	resolvedTheme.value === 'dark' && props.node.attrs.darkSrc
		? props.node.attrs.darkSrc
		: props.node.attrs.src,
);

const canReplace = computed(
	() =>
		isEditable.value &&
		!!props.extension.options.uploadImage &&
		!props.node.attrs.error,
);

const replaceOptions = computed(() => [
	{
		label: 'Replace image',
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
	if (props.editor.isDestroyed) return;

	const attributes = {
		both: { src: url, darkSrc: null },
		light: { src: url },
		dark: { darkSrc: url },
	};
	props.updateAttributes(attributes[replacingVariant.value]);
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
		props.editor.commands.setNodeSelection(pos);
	}
}

function handleKeydown(event) {
	const pos = props.getPos();
	if (typeof pos !== 'number') return;

	if (event.key === 'Enter') {
		event.preventDefault();
		// Insert paragraph after image and move cursor there
		const endPos = pos + props.node.nodeSize;
		props.editor
			.chain()
			.focus()
			.insertContentAt(endPos, { type: 'paragraph' })
			.setTextSelection(endPos + 1)
			.run();
	} else if (event.key === 'Escape' || event.key === 'ArrowDown') {
		event.preventDefault();
		// Move cursor after the image
		const endPos = pos + props.node.nodeSize;
		props.editor.chain().focus().setTextSelection(endPos).run();
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		// Move cursor before the image
		props.editor.chain().focus().setTextSelection(pos).run();
	}
}
</script>

<style scoped>
.wiki-image-wrapper {
    display: block;
    margin: 1rem 0;
}

/* The image carries the selection ring, so the editor's generic one on the
   wrapper would draw a second box around the caption. */
.wiki-image-wrapper.is-selected {
    outline: none;
}

.wiki-image-wrapper.is-selected .wiki-image {
    outline: 2px solid var(--ink-gray-9);
    outline-offset: 2px;
}

.wiki-image-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
}

.wiki-image-frame {
    position: relative;
    display: inline-flex;
    max-width: 100%;
}

.wiki-image {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    cursor: pointer;
    margin: 0;
}

.wiki-image-menu-button {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
}

.wiki-image.is-loading {
    filter: brightness(0.7);
}

.wiki-image-loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 0.375rem;
    background: rgba(17, 17, 17, 0.35);
    color: #fff;
    font-size: 0.8125rem;
}

.wiki-image-spinner {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: wiki-image-spin 0.7s linear infinite;
}

@keyframes wiki-image-spin {
    to {
        transform: rotate(360deg);
    }
}

.wiki-image-error {
    width: 100%;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--ink-red-4, #dc2626);
    padding: 0.5rem 0;
}

.wiki-image-caption-input {
    width: 100%;
    max-width: 100%;
    text-align: center;
    background: transparent;
    border: none;
    font-style: italic;
    font-size: 0.875rem;
    color: var(--ink-gray-6, #4b5563);
    padding: 0 0.25rem;
    margin-top: 0.25rem;
    outline: none;
    box-shadow: none;
}

.wiki-image-caption-input::placeholder {
    color: var(--ink-gray-4, #9ca3af);
}

.wiki-image-caption-input:focus {
    outline: none;
    box-shadow: none;
    border: none;
}

.wiki-image-caption-input:disabled {
    cursor: default;
}

.wiki-image-caption-input:disabled:not(.has-caption) {
    display: none;
}
</style>
