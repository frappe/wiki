<script setup>
import H2Icon from "./icons/h-2.vue";
import LinkIcon from "./icons/link.vue";
import BoldIcon from "./icons/bold.vue";
import ItalicIcon from "./icons/italic.vue";
import TableIcon from "./icons/table-2.vue";
import CodeViewIcon from "./icons/code-view.vue";
import HorizontalRule from "./icons/separator.vue"
import AlignLeftIcon from "./icons/align-left.vue";
import AlignRightIcon from "./icons/align-right.vue";
import AlignCenterIcon from "./icons/align-center.vue";
import ListOrderedIcon from "./icons/list-ordered.vue";
import BlockquoteIcon from "./icons/double-quotes-r.vue";
import ImageAddLineIcon from "./icons/image-add-line.vue";
import ListUnorderedIcon from "./icons/list-unordered.vue";
</script>

<template>
  <editor-content :editor="editor" />
  <div v-if="editor">
    <div class="dropdown">
      <button class="dropdown-toggle" type="button" id="dropdownMenuButton" data-toggle="dropdown" aria-haspopup="true"
        aria-expanded="false">
        <H2Icon />
      </button>
      <div class="dropdown-menu" aria-labelledby="headingDropdownMenuButton">
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 1 }) }">
          Heading 1
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }">
          Heading 2
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 3 }) }">
          Heading 3
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 4 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 4 }) }">
          Heading 4
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 5 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 5 }) }">
          Heading 5
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeading({ level: 6 }).run()"
          :class="{ 'is-active': editor.isActive('heading', { level: 6 }) }">
          Heading 6
        </a>
      </div>
    </div>
    <div class="vertical-sep"></div>
    <button @click="editor.chain().focus().toggleBold().run()"
      :disabled="!editor.can().chain().focus().toggleBold().run()" :class="{ 'is-active': editor.isActive('bold') }">
      <BoldIcon />
    </button>
    <button @click="editor.chain().focus().toggleItalic().run()"
      :disabled="!editor.can().chain().focus().toggleItalic().run()" :class="{ 'is-active': editor.isActive('italic') }">
      <ItalicIcon />
    </button>
    <div class="vertical-sep"></div>
    <button @click="editor.chain().focus().toggleBulletList().run()"
      :class="{ 'is-active': editor.isActive('bulletList') }">
      <ListUnorderedIcon />
    </button>
    <button @click="editor.chain().focus().toggleOrderedList().run()"
      :class="{ 'is-active': editor.isActive('orderedList') }">
      <ListOrderedIcon />
    </button>
    <div class="vertical-sep"></div>
    <button @click="editor.chain().focus().setTextAlign('left').run()"
      :class="{ 'is-active': editor.isActive({ textAlign: 'left' }) }">
      <AlignLeftIcon />
    </button>
    <button @click="editor.chain().focus().setTextAlign('center').run()"
      :class="{ 'is-active': editor.isActive({ textAlign: 'center' }) }">
      <AlignCenterIcon />
    </button>
    <button @click="editor.chain().focus().setTextAlign('right').run()"
      :class="{ 'is-active': editor.isActive({ textAlign: 'right' }) }">
      <AlignRightIcon />
    </button>
    <div class="vertical-sep"></div>
    <button @click="addImage" :class="{ 'is-active': editor.isActive('image') }">
      <ImageAddLineIcon />
    </button>
    <button @click="openLinkDialog" :class="{ 'is-active': editor.isActive('link') }">
      <LinkIcon />
    </button>
    <div class="modal fade" id="linkModal" tabindex="-1" role="dialog" aria-labelledby="linkModal" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="linkModalTitle">Set Link</h5>
          </div>
          <div class="modal-body">
            <input type="text" id="link" name="link">
          </div>
          <div class="modal-footer">
            <button type="button" @click="setLink" class="btn btn-primary btn-sm" data-dismiss="modal">Save</button>
          </div>
        </div>
      </div>
    </div>
    <button @click="editor.chain().focus().toggleBlockquote().run()"
      :class="{ 'is-active': editor.isActive('blockquote') }">
      <BlockquoteIcon />
    </button>
    <button @click="editor.chain().focus().toggleCodeBlock().run()"
      :class="{ 'is-active': editor.isActive('codeBlock') }">
      <CodeViewIcon />
    </button>
    <button @click="editor.chain().focus().setHorizontalRule().run()">
      <HorizontalRule />
    </button>
    <div class="dropdown">
      <button class="dropdown-toggle" type="button" id="dropdownMenuButton" data-toggle="dropdown" aria-haspopup="true"
        aria-expanded="false">
        <TableIcon />
      </button>
      <div class="dropdown-menu" aria-labelledby="tableDropdownMenuButton">
        <a class="dropdown-item" @click="
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        ">
          Insert Table
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().addColumnBefore().run()">
          Add Column Before
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().addColumnAfter().run()">
          Add Column After
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().deleteColumn().run()">
          Delete Column
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().addRowBefore().run()">
          Add Row Before
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().addRowAfter().run()">
          Add Row After
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().deleteRow().run()">
          Delete Row
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeaderColumn().run()">
          Toggle Header Column
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeaderRow().run()">
          Toggle Header Row
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().toggleHeaderCell().run()">
          Toggle Header Cell
        </a>
        <a class="dropdown-item" @click="editor.chain().focus().deleteTable().run()">
          Delete Table
        </a>
      </div>
    </div>
    <div class="wiki-edit-control-btn hide">
      <div class="btn btn-primary-light discard-edit-btn btn-sm">Discard</div>
      <div class="btn btn-primary save-wiki-page-btn btn-sm" @click="saveWikiPage">Save</div>
    </div>
  </div>
</template>

<script>
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import TableCell from "@tiptap/extension-table-cell";
import { Editor, EditorContent } from "@tiptap/vue-3";
import Placeholder from "@tiptap/extension-placeholder";
import TableHeader from "@tiptap/extension-table-header";

const CustomDocument = Document.extend({
  content: "heading block*",
});

export default {
  components: {
    EditorContent,
  },

  data() {
    return {
      editor: null,
    };
  },

  mounted() {
    this.editor = new Editor({
      extensions: [
        CustomDocument,
        StarterKit.configure({
          document: false,
        }),
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === "heading") return "What’s the title?";
          },
        }),
        Link.configure({
          openOnClick: false,
        }),
        Image.configure({
          allowBase64: true,
          inline: true,
        }),
        Table,
        TableRow,
        TableHeader,
        TableCell,
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
      ],
      content: $(".from-markdown").html(),
    });
  },

  methods: {
    openLinkDialog() {
      $('#linkModal').modal();
      const previousUrl = this.editor.getAttributes("link").href;
      if (previousUrl) $(".modal-body #link").val(previousUrl)
      else $(".modal-body #link").val("")
    },
    setLink() {
      $('#linkModal').modal();
      const link = $(".modal-body #link").val()
      if (link === null) return;

      // empty
      if (link === "") {
        this.editor.chain().focus().extendMarkRange("link").unsetLink().run();
        return;
      }

      // update link
      this.editor.chain().focus().extendMarkRange("link").setLink({ href: link }).run();
    },
    addImage() {
      const input = document.createElement('input');
      input.type = 'file';

      input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = readerEvent => {
          const content = readerEvent.target.result;
          if (content) {
            this.editor.chain().focus().setImage({ src: content }).run()
          }
        }
      }
      input.click();
    },
    saveWikiPage() {
      frappe.call({
        method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
        args: {
          name: $('[name="wiki-page-name"]').val(),
          // wiki_page_patch: $('[name="wiki_page_patch"]').val(),
          // message: this.get_value("edit_message"),

          // markdown=1 tag is needed for older wiki content to properly render
          content: `<div markdown="1">${$(".ProseMirror").html().replace(/<h1>.*?<\/h1>/, '')}</div>`,
          type: "Rich Text",
          // attachments: me.attachments,
          // new: $('[name="new"]').val(),
          title: $(".ProseMirror h1").html(),
          // new_sidebar: $(".doc-sidebar").get(0).innerHTML,
          // new_sidebar_items: side,
          // draft: draft ? draft : null,
        },
        callback: (r) => {
          // if (!r.message.approved && r.message.route == "contributions") {
          //   frappe.msgprint({
          //     message:
          //       "A Change Request has been created. You can track your requests on the contributions page",
          //     indicator: "green",
          //     title: "Change Request Created",
          //     alert: 1,
          //   });
          // } else if (!r.message.approved && r.message.route == "drafts") {
          //   frappe.msgprint({
          //     message: "Draft Saved",
          //     indicator: "green",
          //     title: "Change Request Created",
          //     alert: 1,
          //   });
          // }

          // route back to the main page
          window.location.href = "/" + r.message.route;
        },
        freeze: true,
      });
    }
  },

  beforeUnmount() {
    this.editor.destroy();
  },
};
</script>
