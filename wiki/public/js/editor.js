import * as Ace from "ace-builds";
import "ace-builds/src-noconflict/theme-tomorrow_night";
import "ace-builds/src-noconflict/mode-markdown";

const editorContainer = document.getElementById("wiki-editor");
const previewContainer = $("#preview-container");
const previewToggleBtn = $("#toggle-btn");
const wikiTitleInput = $(".wiki-title-input");
const editWikiBtn = $(".edit-wiki-btn");
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
  if (urlParams.get("editWiki") === "1") {
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
  editor.setOptions({
    wrap: true,
    showPrintMargin: true,
    theme: "ace/theme/tomorrow_night",
  });
  editor.renderer.lineHeight = 20;
  editor.setValue(markdown_content || "", 1);
  wikiTitleInput.val($(".wiki-title").text() || "");
}

function saveWikiPage(draft = false) {
  const title = wikiTitleInput.val();
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
        `![](${encodeURI(file_doc.file_url)}`,
      );
    },
  });
});
