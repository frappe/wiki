<template>
    <div class="p-2 w-72 flex flex-col gap-1.5 bg-surface-base shadow-xl rounded-6 border border-outline-gray-2">
        <div class="flex items-center gap-2">
            <TextInput
                v-if="isEditing"
                ref="inputRef"
                type="text"
                class="w-full"
                placeholder="https://example.com"
                v-model="editUrl"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? errorId : undefined"
                @keydown.enter="saveLink"
                @keydown.escape="cancelEdit"
            />
            <a
                v-else-if="page"
                class="text-ink-gray-7 underline text-sm flex-1 truncate ps-1 flex items-center gap-1.5"
                :title="page.title"
                :href="page.href"
                target="_blank"
            >
                <span class="lucide-file-text size-4 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ page.title }}</span>
            </a>
            <a
                v-else
                class="text-ink-gray-7 underline text-sm flex-1 truncate ps-1"
                :title="currentHref"
                :href="currentHref"
                target="_blank"
            >
                {{ currentHref }}
            </a>
            <div class="shrink-0 flex items-center gap-1.5 ms-auto">
                <template v-if="isEditing">
                    <Button
                        @click="saveLink"
                        title="Submit"
                        variant="subtle"
                    >
                        <template #icon>
                            <span class="lucide-check size-4" aria-hidden="true" />
                        </template>
                    </Button>
                    <Button
                        @click="cancelEdit"
                        title="Cancel"
                        variant="subtle"
                    >
                        <template #icon>
                            <span class="lucide-x size-4" aria-hidden="true" />
                        </template>
                    </Button>
                </template>
                <template v-else>
                    <Button
                        @click="copyLink"
                        title="Copy"
                        variant="subtle"
                    >
                        <template #icon>
                            <span class="lucide-copy size-4" aria-hidden="true" />
                        </template>
                    </Button>
                    <Button
                        @click="startEditing"
                        title="Edit"
                        variant="subtle"
                    >
                        <template #icon>
                            <span class="lucide-pencil size-4" aria-hidden="true" />
                        </template>
                    </Button>
                    <Button
                        @click="removeLink"
                        title="Remove"
                        variant="subtle"
                    >
                        <template #icon>
                            <span class="lucide-link-2-off size-4" aria-hidden="true" />
                        </template>
                    </Button>
                </template>
            </div>
        </div>
        <p v-if="error" :id="errorId" role="alert" class="px-1 text-xs text-ink-red-7">
            {{ error }}
        </p>
    </div>
</template>

<script setup>
import { Button, TextInput, toast } from 'frappe-ui';
import { nextTick, onMounted, ref, useId, watch } from 'vue';
import { parseLinkHref } from './link-href.js';

const props = defineProps({
	href: {
		type: String,
		default: '',
	},
	// The wiki page an internal `wiki:` link points at: { title, href }.
	page: {
		type: Object,
		default: null,
	},
	isNew: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(['save', 'remove', 'cancel']);

const inputRef = ref(null);
const isEditing = ref(props.isNew || props.href === '');
const editUrl = ref(props.href || '');
const currentHref = ref(props.href || '');
const error = ref('');
const errorId = useId();

watch(editUrl, () => {
	error.value = '';
});

function startEditing() {
	editUrl.value = currentHref.value;
	isEditing.value = true;
	nextTick(() => {
		if (inputRef.value?.el) {
			inputRef.value.el.focus();
			inputRef.value.el.select();
		}
	});
}

function saveLink() {
	const url = editUrl.value.trim();

	// Saving '' would leave the text wrapped in a link with no href.
	if (!url) {
		emit('remove');
		return;
	}

	const href = parseLinkHref(url);
	if (!href) {
		error.value = __(
			'Enter a valid web address, email, or phone number with a + prefix.',
		);
		inputRef.value?.focus();
		return;
	}
	currentHref.value = href;
	isEditing.value = false;
	emit('save', href);
}

function cancelEdit() {
	error.value = '';
	if (props.href) {
		isEditing.value = false;
		editUrl.value = currentHref.value;
	} else {
		emit('cancel');
	}
}

function removeLink() {
	emit('remove');
}

async function copyLink() {
	if (currentHref.value) {
		try {
			await navigator.clipboard.writeText(currentHref.value);
			toast.success('Link copied');
		} catch {
			toast.error('Failed to copy');
		}
	}
}

watch(
	() => props.href,
	(newHref) => {
		currentHref.value = newHref || '';
		editUrl.value = newHref || '';
		isEditing.value = newHref === '';
	},
);

onMounted(async () => {
	await nextTick();
	if (inputRef.value?.el && isEditing.value) {
		inputRef.value.el.focus();
		inputRef.value.el.select();
	}
});

defineExpose({
	startEditing,
});
</script>
