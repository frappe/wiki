<template>
    <Button :loading="!editor && editor.loading" @click="saveToDB">Save to DB</Button>

    <div class="border border-gray-300 rounded-md p-4 mt-4">
        <Milkdown />
    </div>
</template>

<script setup>
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

import { Crepe } from "@milkdown/crepe";
import { getMarkdown } from "@milkdown/kit/utils";
import { Milkdown, useEditor } from "@milkdown/vue";
import { watch } from "vue";

const props = defineProps({
    content: {
        type: String,
        required: true
    }
});

const emit = defineEmits(['save']);

const content = props.content;
const editor = useEditor((root) => {
    return new Crepe({ root, defaultValue: content });
});


function saveToDB() {
    const markdown = editor.get()?.action(getMarkdown())
    console.log("Current Markdown content:", markdown);
    emit('save', markdown);
}
</script>