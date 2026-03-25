import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CodeBlockView from './CodeBlockView.vue';

export const WikiCodeBlock = CodeBlockLowlight.extend({
	addNodeView() {
		return VueNodeViewRenderer(CodeBlockView);
	},
});
