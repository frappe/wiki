<template>
    <NodeViewWrapper class="wiki-image-wrapper" :class="{ 'is-selected': selected }">
        <div class="wiki-image-container">
            <img
                :src="node.attrs.src"
                :alt="node.attrs.alt || ''"
                :title="node.attrs.title || ''"
                :width="node.attrs.width || undefined"
                :height="node.attrs.height || undefined"
                class="wiki-image"
                @click="selectNode"
            />
            <input
                v-if="editor.isEditable || node.attrs.caption"
                ref="captionInput"
                v-model="caption"
                type="text"
                class="wiki-image-caption-input"
                :class="{ 'has-caption': !!caption }"
                placeholder="Add caption..."
                :disabled="!editor.isEditable"
                @input="updateCaption"
                @keydown="handleKeydown"
            />
        </div>
    </NodeViewWrapper>
</template>

<script setup>
import { ref, watch } from 'vue';
import { NodeViewWrapper } from '@tiptap/vue-3';

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
});

const captionInput = ref(null);
const caption = ref(props.node.attrs.caption || '');

// Watch for external changes to caption attribute
watch(
    () => props.node.attrs.caption,
    (newCaption) => {
        if (newCaption !== caption.value) {
            caption.value = newCaption || '';
        }
    }
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

.wiki-image-wrapper.is-selected .wiki-image {
    outline: 2px solid var(--primary, #171717);
    outline-offset: 2px;
}

.wiki-image-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
}

.wiki-image {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    cursor: pointer;
    margin: 0;
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
