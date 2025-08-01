import * as Ace from "ace-builds";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/theme-tomorrow_night";

const editorContainer = document.getElementById("wiki-editor");
const previewContainer = $("#preview-container");
const previewToggleBtn = $("#toggle-btn");
const wikiTitleInput = $(".wiki-title-input");
const editWikiBtn = $(".edit-wiki-btn, .sidebar-edit-mode-btn");
const saveWikiPageBtn = document.querySelector(
  '[data-wiki-button="saveWikiPage"]',
);
const draftWikiPageBtn = document.querySelector(
  '[data-wiki-button="draftWikiPage"]',
);
let showPreview = false;

let editor = Ace.edit(editorContainer, {
  mode: "ace/mode/markdown",
  placeholder: "Write your content here...",
  theme: "ace/theme/tomorrow_night",
});

editWikiBtn.on("click", () => {
  setEditor();
});

$(document).ready(() => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("editWiki") || urlParams.get("wikiPagePatch")) {
    setEditor();
  }
});

previewContainer.hide();
previewToggleBtn.on("click", function () {
  showPreview = !showPreview;
  previewToggleBtn.text(showPreview ? "Edit" : "Preview");
  if (showPreview) {
    previewContainer.show();
    $(".wiki-editor-container").hide();
    frappe.call({
      method: "wiki.wiki.doctype.wiki_page.wiki_page.convert_markdown",
      args: {
        markdown: editor.getValue(),
      },
      callback: (r) => {
        previewContainer.html(`<h1>${wikiTitleInput.val()}</h1>` + r.message);
      },
    });
  } else {
    previewContainer.hide();
    $(".wiki-editor-container").show();
  }
});

function setEditor() {
  const urlParams = new URLSearchParams(window.location.search);
  const currentUrl = new URL(window.location.href);

  editor.setOptions({
    wrap: true,
    showPrintMargin: true,
    theme: "ace/theme/tomorrow_night",
  });
  editor.renderer.lineHeight = 20;
  frappe.call({
    method: "wiki.wiki.doctype.wiki_page.wiki_page.get_markdown_content",
    args: {
      wikiPageName,
      wikiPagePatch: urlParams.get("wikiPagePatch") || "",
    },
    callback: (r) => {
      editor.setValue(r.message.content || "", 1);
      currentUrl.searchParams.set("editWiki", 1);
      window.history.replaceState({}, "", currentUrl);
    },
  });
  wikiTitleInput.val($(".wiki-title").text()?.trim() || "");
}

function saveWikiPage(draft = false) {
  const title = wikiTitleInput.val()?.trim();
  const content = editor.getValue();
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");
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
}

saveWikiPageBtn.addEventListener("click", () => {
  saveWikiPage();
});

draftWikiPageBtn.addEventListener("click", () => {
  saveWikiPage((draft = true));
});

$(".sidebar-items > .list-unstyled").on("click", ".add-sidebar-page", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmptyEditor = !!urlParams.get("newWiki");
  if ($(".editor-space").is(":visible") || isEmptyEditor) {
    $(".discard-edit-btn").attr("data-new", true);
  }
  wikiTitleInput.val("");
  editor.setValue("");
  $(".admin-banner").addClass("hide");

  // workaround to fix the param not getting set
  setTimeout(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("newWiki", "1");
    window[`history`]["pushState"]({}, "", url);
  }, 1);
});

editorContainer.addEventListener(
  "dragover",
  function (e) {
    e.preventDefault();
    e.stopPropagation();
  },
  500,
);

editorContainer.addEventListener("drop", function (e) {
  e.preventDefault();
  e.stopPropagation();
  let dataTransfer = e.dataTransfer;
  if (!dataTransfer?.files?.length) {
    return;
  }
  let files = dataTransfer.files;
  if (!files[0].type.includes("image")) {
    frappe.show_alert({
      message: __("You can only insert images in Markdown fields", [
        files[0].name,
      ]),
      indicator: "orange",
    });
    return;
  }
  new frappe.ui.FileUploader({
    dialog_title: __("Insert Image in Markdown"),
    doctype: this.doctype,
    docname: this.docname,
    frm: this.frm,
    files,
    folder: "Home/Attachments",
    allow_multiple: false,
    restrictions: {
      allowed_file_types: ["image/*"],
    },
    on_success: (file_doc) => {
      if (this.frm && !this.frm.is_new()) {
        this.frm.attachments.attachment_uploaded(file_doc);
      }
      editor.session.insert(
        editor.getCursorPosition(),
        `![](${encodeURI(file_doc.file_url)})`,
      );
    },
  });
});

function insertMarkdown(type) {
  const selection = editor.getSelectedText();
  let insertion = "";

  switch (type) {
    case "bold":
      insertion = `**${selection || "bold text"}**`;
      break;
    case "italic":
      insertion = `*${selection || "italic text"}*`;
      break;
    case "heading":
      insertion = `\n# ${selection || "Heading"}`;
      break;
    case "quote":
      insertion = `\n> ${selection || "Quote"}`;
      break;
    case "olist":
      insertion = `\n1. ${selection || "List item"}`;
      break;
    case "ulist":
      insertion = `\n* ${selection || "List item"}`;
      break;
    case "link":
      insertion = `[${selection || "link text"}](url)`;
      break;
    case "image":
      new frappe.ui.FileUploader({
        dialog_title: __("Insert Image in Markdown"),
        doctype: this.doctype,
        docname: this.docname,
        frm: this.frm,
        folder: "Home/Attachments",
        disable_file_browser: true,
        allow_toggle_private: false,
        allow_multiple: false,
        restrictions: {
          allowed_file_types: ["image/*"],
        },
        on_success: (file_doc) => {
          if (this.frm && !this.frm.is_new()) {
            this.frm.attachments.attachment_uploaded(file_doc);
          }
          editor.session.insert(
            editor.getCursorPosition(),
            `\n![](${encodeURI(file_doc.file_url)})`,
          );
        },
      });
      break;
    case "table":
      insertion = `${selection}\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Row 1 | Row 1 |\n| Row 2 | Row 2 |`;
      break;
    case "disclosure":
      insertion = `\n<details>\n<summary>${
        selection || "Title"
      }</summary>\nContent\n</details>`;
      break;
  }

  editor.insert(insertion);
  editor.focus();
}

const mdeBoldBtn = document.querySelector('[data-mde-button="bold"]');
const mdeItalicBtn = document.querySelector('[data-mde-button="italic"]');
const mdeHeadingBtn = document.querySelector('[data-mde-button="heading"]');
const mdeQuoteBtn = document.querySelector('[data-mde-button="quote"]');
const mdeOlistBtn = document.querySelector('[data-mde-button="olist"]');
const mdeUlistBtn = document.querySelector('[data-mde-button="ulist"]');
const mdeLinkBtn = document.querySelector('[data-mde-button="link"]');
const mdeImageBtn = document.querySelector('[data-mde-button="image"]');
const mdeTableBtn = document.querySelector('[data-mde-button="table"]');
const mdeDisclosureBtn = document.querySelector(
  '[data-mde-button="disclosure"]',
);

mdeBoldBtn.addEventListener("click", () => insertMarkdown("bold"));
mdeItalicBtn.addEventListener("click", () => insertMarkdown("italic"));
mdeHeadingBtn.addEventListener("click", () => insertMarkdown("heading"));
mdeQuoteBtn.addEventListener("click", () => insertMarkdown("quote"));
mdeOlistBtn.addEventListener("click", () => insertMarkdown("olist"));
mdeUlistBtn.addEventListener("click", () => insertMarkdown("ulist"));
mdeLinkBtn.addEventListener("click", () => insertMarkdown("link"));
mdeImageBtn.addEventListener("click", () => insertMarkdown("image"));
mdeTableBtn.addEventListener("click", () => insertMarkdown("table"));
mdeDisclosureBtn.addEventListener("click", () => insertMarkdown("disclosure"));

editor.commands.addCommand({
  name: "bold",
  bindKey: { win: "Ctrl-B", mac: "Command-B" },
  exec: () => insertMarkdown("bold"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "italic",
  bindKey: { win: "Ctrl-I", mac: "Command-I" },
  exec: () => insertMarkdown("italic"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "heading",
  bindKey: { win: "Ctrl-H", mac: "Command-H" },
  exec: () => insertMarkdown("heading"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "quote",
  bindKey: { win: "Ctrl-Shift-.", mac: "Command-Shift-." },
  exec: () => insertMarkdown("quote"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "orderedList",
  bindKey: { win: "Ctrl-Shift-7", mac: "Command-Shift-7" },
  exec: () => insertMarkdown("olist"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "unorderedList",
  bindKey: { win: "Ctrl-Shift-8", mac: "Command-Shift-8" },
  exec: () => insertMarkdown("ulist"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "link",
  bindKey: { win: "Ctrl-K", mac: "Command-K" },
  exec: () => insertMarkdown("link"),
  readOnly: false,
});

editor.commands.addCommand({
  name: "image",
  bindKey: { win: "Ctrl-P", mac: "Command-P" },
  exec: () => insertMarkdown("image"),
  readOnly: false,
});
