<script setup>
/**
 * VideoBlockView Component
 *
 * Renders a video with HTML5 video player in the TipTap editor.
 * Supports common video formats: mp4, webm, ogg, mov, avi, mkv, m4v
 */

import { computed } from 'vue';
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
});

const src = computed(() => props.node.attrs.src || '');

// Get video MIME type from extension
const videoType = computed(() => {
    const url = src.value.toLowerCase();
    if (url.endsWith('.mp4') || url.endsWith('.m4v')) return 'video/mp4';
    if (url.endsWith('.webm')) return 'video/webm';
    if (url.endsWith('.ogg')) return 'video/ogg';
    if (url.endsWith('.mov')) return 'video/quicktime';
    if (url.endsWith('.avi')) return 'video/x-msvideo';
    if (url.endsWith('.mkv')) return 'video/x-matroska';
    return 'video/mp4'; // Default fallback
});
</script>

<template>
    <NodeViewWrapper
        class="video-block-wrapper"
        :class="{ 'is-selected': selected }"
        contenteditable="false"
    >
        <div v-if="!src" class="video-placeholder">
            <div class="placeholder-content">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span>Video</span>
            </div>
        </div>
        <div v-else class="video-container">
            <video
                :src="src"
                controls
                preload="metadata"
                class="video-player"
            >
                <source :src="src" :type="videoType" />
                Your browser does not support the video tag.
            </video>
        </div>
    </NodeViewWrapper>
</template>

<style scoped>
.video-block-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0.25rem 0;
    padding: 0;
    border-radius: 8px;
    transition: background-color 0.2s ease;
}

.video-block-wrapper.is-selected {
    background-color: rgba(59, 130, 246, 0.1);
    outline: 2px solid rgba(59, 130, 246, 0.5);
}

.video-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 200px;
    background-color: #f3f4f6;
    border: 2px dashed #d1d5db;
    border-radius: 8px;
    cursor: pointer;
}

.placeholder-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #6b7280;
}

.placeholder-content svg {
    width: 48px;
    height: 48px;
    opacity: 0.5;
}

.video-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 100%;
}

.video-player {
    width: 100%;
    max-width: 100%;
    border-radius: 8px;
    background-color: #000;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
    .video-placeholder {
        background-color: #374151;
        border-color: #4b5563;
    }

    .placeholder-content {
        color: #9ca3af;
    }
}
</style>
