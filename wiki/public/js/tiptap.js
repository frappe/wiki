import { createApp } from "vue";
import Tiptap from "./Tiptap.vue";

createApp(Tiptap).mount(".wiki-editor");
createApp(Tiptap, { isEmptyEditor: true }).mount(".new-wiki-editor");

export default Tiptap;
