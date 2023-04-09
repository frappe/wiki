import { lowlight } from "lowlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import TableCell from "@tiptap/extension-table-cell";
import { Editor, InputRule } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

const CustomDocument = Document.extend({
  content: "heading block*",
});

const disableMarkdownShortcut = (markdownShortcut, originalChar) => {
  return new InputRule(
    new RegExp(`(^|[\\s])${markdownShortcut}(?![\\w])`, "g"),
    (state, match, start, end) => {
      const text = state.doc.textBetween(start, end);
      if (text === markdownShortcut) {
        return originalChar;
      }
      return null;
    },
  );
};

const getContent = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");

  if (patchNewCode !== "<h1>{{ patch_new_title }}</h1>{{ patch_new_code }}")
    return patchNewCode;
  else if (!isEmptyEditor)
    return $(".from-markdown")
      .html()
      .replaceAll(/<br class="ProseMirror-trailingBreak">/g, "");
  return "<h1></h1><p></p>";
};

const saveWikiPage = (draft = false) => {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");

  const title = $(`.wiki-editor .ProseMirror h1`).html();
  // markdown=1 tag is needed for older wiki content to properly render
  const content = `<div markdown="1">${$(`.wiki-editor .ProseMirror`)
    .html()
    .replace(/<h1>.*?<\/h1>/, "")}</div>`;

  frappe.call({
    method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
    args: {
      name: $('[name="wiki-page-name"]').val(),
      message: `${isEmptyEditor ? "Created" : "Edited"} ${title}`,
      content,
      new: isEmptyEditor,
      new_sidebar_items: isEmptyEditor ? getSidebarItems() : "",
      title,
      draft,
      new_sidebar_group: isEmptyEditor ? urlParams.get("newWiki") : "",
      wiki_page_patch: urlParams.get("wikiPagePatch"),
    },
    callback: (r) => {
      // route back to the main page

      window.location.href = "/" + r.message.route;
    },
    freeze: true,
  });
};

const editor = new Editor({
  element: document.querySelector(".wiki-editor .editor-space"),
  extensions: [
    CustomDocument,
    StarterKit.configure({
      document: false,
      codeBlock: false,
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading" && node.attrs.level === 1)
          return "What’s the Wiki title?";
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
      types: ["heading", "paragraph"],
    }),
    CodeBlockLowlight.configure({
      lowlight,
    }),
  ],
  inputRules: [disableMarkdownShortcut("#", "#")],
  content: getContent(),
});

const buttons = {
  h2: document.querySelector('[data-tiptap-button="h2"]'),
  h3: document.querySelector('[data-tiptap-button="h3"]'),
  h4: document.querySelector('[data-tiptap-button="h4"]'),
  h5: document.querySelector('[data-tiptap-button="h5"]'),
  h6: document.querySelector('[data-tiptap-button="h6"]'),
  bold: document.querySelector('[data-tiptap-button="bold"]'),
  italic: document.querySelector('[data-tiptap-button="italic"]'),
  bulletList: document.querySelector('[data-tiptap-button="bulletList"]'),
  orderedList: document.querySelector('[data-tiptap-button="orderedList"]'),
  alignLeft: document.querySelector('[data-tiptap-button="alignLeft"]'),
  alignCenter: document.querySelector('[data-tiptap-button="alignCenter"]'),
  alignRight: document.querySelector('[data-tiptap-button="alignRight"]'),
  image: document.querySelector('[data-tiptap-button="image"]'),
  link: document.querySelector('[data-tiptap-button="link"]'),
  blockquote: document.querySelector('[data-tiptap-button="blockquote"]'),
  codeBlock: document.querySelector('[data-tiptap-button="codeBlock"]'),
  horizontalRule: document.querySelector(
    '[data-tiptap-button="horizontalRule"]',
  ),
  insertTable: document.querySelector('[data-tiptap-button="insertTable"]'),
  addColumnBefore: document.querySelector(
    '[data-tiptap-button="addColumnBefore"]',
  ),
  addColumnAfter: document.querySelector(
    '[data-tiptap-button="addColumnAfter"]',
  ),
  deleteColumn: document.querySelector('[data-tiptap-button="deleteColumn"]'),
  addRowBefore: document.querySelector('[data-tiptap-button="addRowBefore"]'),
  addRowAfter: document.querySelector('[data-tiptap-button="addRowAfter"]'),
  deleteRow: document.querySelector('[data-tiptap-button="deleteRow"]'),
  toggleHeaderColumn: document.querySelector(
    '[data-tiptap-button="toggleHeaderColumn"]',
  ),
  toggleHeaderRow: document.querySelector(
    '[data-tiptap-button="toggleHeaderRow"]',
  ),
  toggleHeaderCell: document.querySelector(
    '[data-tiptap-button="toggleHeaderCell"]',
  ),
  deleteTable: document.querySelector('[data-tiptap-button="deleteTable"]'),
  saveWikiPage: document.querySelector('[data-tiptap-button="saveWikiPage"]'),
  draftWikiPage: document.querySelector('[data-tiptap-button="draftWikiPage"]'),
};

const setButtonActive = (button, mark) => {
  if (editor.isActive(mark)) {
    button.classList.add("active");
  } else {
    button.classList.remove("active");
  }
};

buttons.h2.addEventListener("click", () => {
  editor.chain().focus().toggleHeading({ level: 2 }).run();
});

buttons.h3.addEventListener("click", () => {
  editor.chain().focus().toggleHeading({ level: 3 }).run();
});

buttons.h4.addEventListener("click", () => {
  editor.chain().focus().toggleHeading({ level: 4 }).run();
});

buttons.h5.addEventListener("click", () => {
  editor.chain().focus().toggleHeading({ level: 5 }).run();
});

buttons.h6.addEventListener("click", () => {
  editor.chain().focus().toggleHeading({ level: 6 }).run();
});

buttons.bold.addEventListener("click", () => {
  editor.chain().focus().toggleBold().run();
  setButtonActive(buttons.bold, "bold");
});

buttons.italic.addEventListener("click", () => {
  editor.chain().focus().toggleItalic().run();
  setButtonActive(buttons.italic, "italic");
});

buttons.bulletList.addEventListener("click", () => {
  editor.chain().focus().toggleBulletList().run();
  setButtonActive(buttons.bulletList, "bulletList");
});

buttons.orderedList.addEventListener("click", () => {
  editor.chain().focus().toggleOrderedList().run();
  setButtonActive(buttons.orderedList, "orderedList");
});

buttons.alignLeft.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("left").run();
  setButtonActive(buttons.alignLeft, { textAlign: "left" });
});

buttons.alignCenter.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("center").run();
  setButtonActive(buttons.alignCenter, { textAlign: "center" });
});

buttons.alignRight.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("right").run();
  setButtonActive(buttons.alignRight, { textAlign: "right" });
});

buttons.image.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";

  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (readerEvent) => {
      const content = readerEvent.target.result;
      if (content) {
        editor.chain().focus().setImage({ src: content }).run();
      }
    };
  };
  input.click();
  setButtonActive(buttons.image, "image");
});

buttons.link.addEventListener("click", () => {
  $("#linkModal").modal();
  const link = $("#linkModal #link").val();
  if (link === null) return;

  // empty
  if (link === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }

  // update link
  editor.chain().focus().extendMarkRange("link").setLink({ href: link }).run();

  setButtonActive(buttons.link, "link");
});

buttons.blockquote.addEventListener("click", () => {
  editor.chain().focus().toggleBlockquote().run();
  setButtonActive(buttons.blockquote, "blockquote");
});

buttons.codeBlock.addEventListener("click", () => {
  editor.chain().focus().toggleCodeBlock().run();
  setButtonActive(buttons.codeBlock, "codeBlock");
});

buttons.horizontalRule.addEventListener("click", () => {
  editor.chain().focus().setHorizontalRule().run();
});

buttons.insertTable.addEventListener("click", () => {
  editor
    .chain()
    .focus()
    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    .run();
});

buttons.addColumnBefore.addEventListener("click", () => {
  editor.chain().focus().addColumnBefore().run();
});

buttons.addColumnAfter.addEventListener("click", () => {
  editor.chain().focus().addColumnAfter().run();
});

buttons.deleteColumn.addEventListener("click", () => {
  editor.chain().focus().deleteColumn().run();
});

buttons.addRowBefore.addEventListener("click", () => {
  editor.chain().focus().addRowBefore().run();
});

buttons.addRowAfter.addEventListener("click", () => {
  editor.chain().focus().addRowAfter().run();
});

buttons.deleteRow.addEventListener("click", () => {
  editor.chain().focus().deleteRow().run();
});

buttons.toggleHeaderColumn.addEventListener("click", () => {
  editor.chain().focus().toggleHeaderColumn().run();
});

buttons.toggleHeaderRow.addEventListener("click", () => {
  editor.chain().focus().toggleHeaderRow().run();
});

buttons.toggleHeaderCell.addEventListener("click", () => {
  editor.chain().focus().toggleHeaderCell().run();
});

buttons.deleteTable.addEventListener("click", () => {
  editor.chain().focus().deleteTable().run();
});

buttons.saveWikiPage.addEventListener("click", () => {
  saveWikiPage();
});

buttons.draftWikiPage.addEventListener("click", () => {
  saveWikiPage((draft = true));
});

$(".add-sidebar-page").on("click", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");
  if ($(".editor-space").is(":visible") || isEmptyEditor) {
    $(".discard-edit-btn").attr("data-new", true);
    if (patchNewCode !== "<h1>{{ patch_new_title }}</h1>{{ patch_new_code }}")
      editor.commands.setContent(patchNewCode);
    else editor.commands.setContent("<h1></h1><p></p>");
  } else $(".discard-edit-btn").attr("data-new", false);

  editor.commands.focus("start");
});

$(".edit-wiki-btn").on("click", () => {
  editor.commands.setContent(getContent());
  editor.commands.focus("start");
});
