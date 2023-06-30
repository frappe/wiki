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
    return `${$(".from-markdown .wiki-title").prop("outerHTML")}${$(
      ".from-markdown .wiki-content",
    ).html()}`.replaceAll(/<br class="ProseMirror-trailingBreak">/g, "");
  return "<h1></h1><p></p>";
};

const saveWikiPage = (draft = false) => {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");

  const title = $(`.wiki-editor .ProseMirror h1`).html();
  // markdown=1 tag is needed for older wiki content to properly render
  // TODO: use editor.getHTML() instead of this when ueberdosis/tiptap#4044 is fixed
  const content = `<div markdown="1">${$(".editor-space .ProseMirror")
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
      HTMLAttributes: {
        class: "screenshot",
      },
    }),
    Table.configure({
      resizable: true,
    }),
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
  modalLink: document.querySelector('[data-modal-button="link"]'),
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

editor.on("transaction", ({ editor, transaction }) => {
  const marks = {
    bold: "bold",
    italic: "italic",
    bulletList: "bulletList",
    orderedList: "orderedList",
    alignLeft: { textAlign: "left" },
    alignCenter: { textAlign: "center" },
    alignRight: { textAlign: "right" },
    image: "image",
    link: "link",
    blockquote: "blockquote",
    codeBlock: "codeBlock",
  };
  for (let mark in marks) {
    if (editor.isActive(marks[mark])) buttons[mark].classList.add("is-active");
    else buttons[mark].classList.remove("is-active");
  }

  const titleMarks = {
    h1: { level: 1 },
    h2: { level: 2 },
    h3: { level: 3 },
    h4: { level: 4 },
    h5: { level: 5 },
    h6: { level: 6 },
  };
  const headingSVG = {
    h1: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M13 20h-2v-7H4v7H2V4h2v7h7V4h2v16zm8-12v12h-2v-9.796l-2 .536V8.67L19.5 8H21z"fill="currentColor"/></svg>`,
    h2: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M4 4v7h7V4h2v16h-2v-7H4v7H2V4h2zm14.5 4c2.071 0 3.75 1.679 3.75 3.75 0 .857-.288 1.648-.772 2.28l-.148.18L18.034 18H22v2h-7v-1.556l4.82-5.546c.268-.307.43-.709.43-1.148 0-.966-.784-1.75-1.75-1.75-.918 0-1.671.707-1.744 1.606l-.006.144h-2C14.75 9.679 16.429 8 18.5 8z" fill="currentColor" /></svg>`,
    h3: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M22 8l-.002 2-2.505 2.883c1.59.435 2.757 1.89 2.757 3.617 0 2.071-1.679 3.75-3.75 3.75-1.826 0-3.347-1.305-3.682-3.033l1.964-.382c.156.806.866 1.415 1.718 1.415.966 0 1.75-.784 1.75-1.75s-.784-1.75-1.75-1.75c-.286 0-.556.069-.794.19l-1.307-1.547L19.35 10H15V8h7zM4 4v7h7V4h2v16h-2v-7H4v7H2V4h2z"fill="currentColor"/></svg>`,
    h4: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M13 20h-2v-7H4v7H2V4h2v7h7V4h2v16zm9-12v8h1.5v2H22v2h-2v-2h-5.5v-1.34l5-8.66H22zm-2 3.133L17.19 16H20v-4.867z"fill="currentColor"/></svg>`,
    h5: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M22 8v2h-4.323l-.464 2.636c.33-.089.678-.136 1.037-.136 2.21 0 4 1.79 4 4s-1.79 4-4 4c-1.827 0-3.367-1.224-3.846-2.897l1.923-.551c.24.836 1.01 1.448 1.923 1.448 1.105 0 2-.895 2-2s-.895-2-2-2c-.63 0-1.193.292-1.56.748l-1.81-.904L16 8h6zM4 4v7h7V4h2v16h-2v-7H4v7H2V4h2z"fill="currentColor"/></svg>`,
    h6: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" d="M0 0H24V24H0z" /><path d="M21.097 8l-2.598 4.5c2.21 0 4.001 1.79 4.001 4s-1.79 4-4 4-4-1.79-4-4c0-.736.199-1.426.546-2.019L18.788 8h2.309zM4 4v7h7V4h2v16h-2v-7H4v7H2V4h2zm14.5 10.5c-1.105 0-2 .895-2 2s.895 2 2 2 2-.895 2-2-.895-2-2-2z"fill="currentColor"/></svg>`,
  };

  for (let mark in titleMarks) {
    if (editor.isActive("heading", titleMarks[mark])) {
      $('[data-tiptap-button="heading"]').empty().prepend(headingSVG[mark]);
      $('[data-tiptap-button="heading"]').addClass("is-active");
      break;
    }
    $('[data-tiptap-button="heading"]').empty().prepend(headingSVG["h2"]);
    $('[data-tiptap-button="heading"]').removeClass("is-active");
  }
});

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
});

buttons.italic.addEventListener("click", () => {
  editor.chain().focus().toggleItalic().run();
});

buttons.bulletList.addEventListener("click", () => {
  editor.chain().focus().toggleBulletList().run();
});

buttons.orderedList.addEventListener("click", () => {
  editor.chain().focus().toggleOrderedList().run();
});

buttons.alignLeft.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("left").run();
});

buttons.alignCenter.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("center").run();
});

buttons.alignRight.addEventListener("click", () => {
  editor.chain().focus().setTextAlign("right").run();
});

buttons.image.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.onchange = (e) => {
    const file = e.target.files[0];
    const fileName = file.name;
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (readerEvent) => {
      const [header, data] = readerEvent.target.result.split(",");
      const content = `${header};filename=${fileName},${data}`;
      if (content) {
        editor
          .chain()
          .focus()
          .setImage({
            src: content,
            title: fileName,
            alt: fileName.split(".").slice(0, -1).join("."),
          })
          .run();
      }
    };
  };
  input.click();
});

buttons.link.addEventListener("click", () => {
  $("#linkModal").modal();
  const previousUrl = editor.getAttributes("link").href;
  if (previousUrl) $("#linkModal #link").val(previousUrl);
  else $("#linkModal #link").val("");
});

buttons.modalLink.addEventListener("click", () => {
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
});

buttons.blockquote.addEventListener("click", () => {
  editor.chain().focus().toggleBlockquote().run();
});

buttons.codeBlock.addEventListener("click", () => {
  editor.chain().focus().toggleCodeBlock().run();
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

$(".sidebar-items > .list-unstyled").on("click", ".add-sidebar-page", () => {
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
