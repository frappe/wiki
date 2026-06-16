<template>
    <Dialog v-model="show">
        <template #body-title>
            <h3 class="text-xl font-semibold text-ink-gray-9">
                {{ __('Page Settings') }}
            </h3>
        </template>
        <template #body-content>
            <div class="space-y-4">
                <FormControl
                    type="text"
                    required
                    :label="__('Title')"
                    v-model="settingsForm.title"
                    :placeholder="__('Page title')"
                />
                <FormControl
                    type="text"
                    required
                    :label="__('Route')"
                    v-model="settingsForm.route"
                    :placeholder="__('e.g., docs/getting-started')"
                />
            </div>
        </template>
        <template #actions="{ close }">
            <div class="flex justify-end gap-2">
                <Button variant="outline" @click="close">
                    {{ __('Cancel') }}
                </Button>
                <Button
                    variant="solid"
                    :loading="settingsResource.loading"
                    @click="saveSettings"
                >
                    {{ __('Save') }}
                </Button>
            </div>
        </template>
    </Dialog>
</template>

<script setup>
import { reactive, watch } from 'vue';
import { createResource, Button, Dialog, FormControl, toast } from "frappe-ui";

const props = defineProps({
    pageId: {
        type: String,
        required: true
    },
    doc: {
        type: Object,
        default: null
    },
});

const show = defineModel({ type: Boolean, default: false });
const emit = defineEmits(['saved']);

const settingsForm = reactive({
    title: '',
    route: '',
});

// Initialize form when dialog opens
watch(show, (isOpen) => {
    if (isOpen && props.doc) {
        settingsForm.title = props.doc.title || '';
        settingsForm.route = props.doc.route || '';
    }
});

const settingsResource = createResource({
    url: 'frappe.client.set_value',
    onSuccess() {
        toast.success(__('Settings saved'));
        show.value = false;
        emit('saved');
    },
    onError(error) {
        toast.error(error.messages?.[0] || __('Error saving settings'));
    },
});

function saveSettings() {
    settingsResource.submit({
        doctype: 'Wiki Document',
        name: props.pageId,
        fieldname: {
            title: settingsForm.title,
            route: settingsForm.route,
        },
    });
}
</script>
