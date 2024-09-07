import * as Ace from "ace-builds";
import "ace-builds/src-noconflict/theme-tomorrow";
import "ace-builds/src-noconflict/mode-markdown";

const editorContainer = document.getElementById("wiki-editor");
const previewToggleBtn = $("#toggle-btn");
const wikiTitleInput = $(".wiki-title-input");
const saveWikiPageBtn = document.querySelector(
  '[data-wiki-button="saveWikiPage"]'
);
const draftWikiPageBtn = document.querySelector(
  '[data-wiki-button="draftWikiPage"]'
);
let show_preview = false;

let editor = Ace.edit(editorContainer, {
  mode: "ace/mode/markdown",
  placeholder: "Wiki Content",
});

$(".edit-wiki-btn").click(() => {
  setEditor();
});

$(document).ready(() => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("editWiki") === "1") {
    setEditor();
  }
});

$("#preview-container").hide();

function setEditor() {
  editor.setOption("wrap", true);
  editor.setOption("showPrintMargin", true);
  editor.setTheme("ace/theme/tomorrow");
  editor.renderer.lineHeight = 20;

  frappe.call({
    method: "wiki.wiki.doctype.wiki_page.wiki_page.convert_html",
    args: {
      html: $(".wiki-content").html(),
    },
    callback: (r) => {
      editor.setValue(r.message, 1);
    },
  });

  $(".wiki-title-input").val($(".wiki-title").text() || "");

  previewToggleBtn.on("click", function () {
    show_preview = !show_preview;
    previewToggleBtn.text(show_preview ? "Edit" : "Preview");
    if (show_preview) {
      $("#preview-container").show();
      $(".wiki-editor-container").hide();
      frappe.call({
        method: "wiki.wiki.doctype.wiki_page.wiki_page.convert_markdown",
        args: {
          markdown: editor.getValue(),
        },
        callback: (r) => {
          $("#preview-container").html(
            `<h1>${$(".wiki-title-input").val()}</h1>` + r.message
          );
        },
      });
    } else {
      $("#preview-container").hide();
      $(".wiki-editor-container").show();
    }
  });
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
  editor.setValue();
  $(".wiki-title-input").val("");
});

// handle image drop
editorContainer.addEventListener(
  "dragover",
  function (e) {
    e.preventDefault();
    e.stopPropagation();
  },
  500
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
        `![](${encodeURI(file_doc.file_url)}`
      );
    },
  });
});
