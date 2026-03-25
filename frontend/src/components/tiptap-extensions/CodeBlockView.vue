<template>
  <node-view-wrapper>
    <div class="group/code relative">
      <div
        class="absolute top-2 right-2 w-32 z-10 opacity-0 pointer-events-none transition-opacity duration-150 ease-in-out group-hover/code:opacity-100 group-hover/code:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
        contenteditable="false"
      >
        <Combobox
          :modelValue="node.attrs.language"
          @update:modelValue="(val) => updateAttributes({ language: val })"
          :options="languages"
          placeholder="auto"
          variant="outline"
        />
      </div>
      <pre><code><node-view-content /></code></pre>
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { Combobox } from 'frappe-ui'

export default {
  components: {
    NodeViewWrapper,
    NodeViewContent,
    Combobox,
  },
  props: nodeViewProps,
  computed: {
    languages() {
      let supportedLanguages = this.extension.options.lowlight.listLanguages()
      return supportedLanguages
        .map((language) => ({
          label: language,
          value: language,
        }))
        .concat([{ label: 'html', value: 'html' }])
        .sort((a, b) => a.label.localeCompare(b.label))
    },
  },
}
</script>
