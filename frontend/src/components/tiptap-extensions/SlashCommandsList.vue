<template>
    <div class="slash-commands-list" v-if="items.length > 0">
        <button
            v-for="(item, index) in items"
            :key="item.title"
            :class="['slash-command-item', { 'is-selected': index === selectedIndex }]"
            @click="selectItem(index)"
            @mouseenter="selectedIndex = index"
        >
            <div class="slash-command-icon">
                <component :is="getIcon(item.icon)" :size="18" :stroke-width="1.5" />
            </div>
            <div class="slash-command-content">
                <div class="slash-command-title">{{ item.title }}</div>
                <div class="slash-command-description">{{ item.description }}</div>
            </div>
        </button>
    </div>
    <div class="slash-commands-empty" v-else>No commands found</div>
</template>

<script setup>
import {
	AlertOctagon,
	AlertTriangle,
	Code,
	Heading1,
	Heading2,
	Heading3,
	HelpCircle,
	Image,
	Info,
	Lightbulb,
	List,
	ListChecks,
	ListOrdered,
	Minus,
	Quote,
	Table,
	Video,
} from 'lucide-vue-next';
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
	items: {
		type: Array,
		required: true,
	},
	command: {
		type: Function,
		required: true,
	},
});

const selectedIndex = ref(0);

// Icon mapping
const iconMap = {
	'heading-1': Heading1,
	'heading-2': Heading2,
	'heading-3': Heading3,
	list: List,
	'list-ordered': ListOrdered,
	'list-checks': ListChecks,
	code: Code,
	quote: Quote,
	minus: Minus,
	table: Table,
	image: Image,
	video: Video,
	info: Info,
	lightbulb: Lightbulb,
	'alert-triangle': AlertTriangle,
	'alert-octagon': AlertOctagon,
};

function getIcon(iconName) {
	return iconMap[iconName] || HelpCircle;
}

function selectItem(index) {
	const item = props.items[index];
	if (item) {
		props.command(item);
	}
}

function onKeyDown(event) {
	if (event.key === 'ArrowUp') {
		event.preventDefault();
		selectedIndex.value =
			(selectedIndex.value - 1 + props.items.length) % props.items.length;
		return true;
	}
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
		return true;
	}
	if (event.key === 'Enter') {
		event.preventDefault();
		selectItem(selectedIndex.value);
		return true;
	}
	return false;
}

// Reset selected index when items change
watch(
	() => props.items,
	() => {
		selectedIndex.value = 0;
	},
);

// Expose onKeyDown for parent component
defineExpose({
	onKeyDown,
});
</script>

<style scoped>
.slash-commands-list {
    background: var(--surface-white, #ffffff);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.5rem;
    box-shadow:
        0 4px 6px -1px rgb(0 0 0 / 0.1),
        0 2px 4px -2px rgb(0 0 0 / 0.1);
    max-height: 300px;
    overflow-y: auto;
    padding: 0.25rem;
    min-width: 240px;
}

.slash-command-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
}

.slash-command-item:hover,
.slash-command-item.is-selected {
    background-color: var(--surface-gray-2, #f3f4f6);
}

.slash-command-icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-gray-1, #f9fafb);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.375rem;
    color: var(--ink-gray-6, #4b5563);
}

.slash-command-content {
    flex: 1;
    min-width: 0;
}

.slash-command-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--ink-gray-9, #111827);
}

.slash-command-description {
    font-size: 0.75rem;
    color: var(--ink-gray-5, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.slash-commands-empty {
    padding: 1rem;
    text-align: center;
    color: var(--ink-gray-5, #6b7280);
    font-size: 0.875rem;
    background: var(--surface-white, #ffffff);
    border: 1px solid var(--outline-gray-2, #e5e7eb);
    border-radius: 0.5rem;
}
</style>
