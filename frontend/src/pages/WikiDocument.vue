<template>  
<div>
    <div v-if="wikiDoc.doc">
        Editing <strong>{{ wikiDoc.doc.title }}</strong>
        <div>
            <a target="_blank" :href="`http://wiki.localhost:8000/${wikiDoc.doc.route}`">View Page</a>
        </div>

        <MilkdownProvider>
            <WikiEditor :content="wikiDoc.doc.content" @save="saveContent" />
        </MilkdownProvider>
    </div>

    
</div>
</template>

<script setup>
import { MilkdownProvider } from "@milkdown/vue";
import { createDocumentResource } from "frappe-ui";
import WikiEditor from '../components/WikiEditor.vue';

const props = defineProps({
    pageId: {
        type: String,
        required: true
    }
});

const wikiDoc = createDocumentResource({
    doctype: "Wiki Document",
    name: props.pageId,
    onSuccess(data) {
        console.log("Wiki Document data:", data);
    },
})

wikiDoc.reload();

function saveContent(content) {
    wikiDoc.setValue.submit({
        content
    })
}
</script>