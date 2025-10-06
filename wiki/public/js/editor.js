import * as Ace from "ace-builds";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/theme-tomorrow_night";

const editorContainer = document.getElementById("wiki-editor");
const previewContainer = $("#preview-container");
const previewToggleBtn = $("#toggle-btn");
const wikiTitleInput = $(".wiki-title-input");
const editWikiBtn = $(".edit-wiki-btn, .sidebar-edit-mode-btn");
const discardEditBtn = $(".discard-edit-btn");
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
  } else if (urlParams.get("newWiki")) {
    const draft = getLocalDraft();
    if (draft && (draft.title || draft.content)) {
      frappe.confirm(
        __(
          `An unsaved draft titled {0} was found. Do you want to continue editing it?`,
          [__(draft.title || draft.content?.substring(0, 10) + "...").bold()],
        ),
        () => setLocalDraftinEditor(draft),
        () => localStorage.removeItem(`wiki_draft_${wikiPageName}`),
      );
    }
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
      const draft = getLocalDraft();
      if (draft) {
        setLocalDraftinEditor(draft);
      } else {
        editor.setValue(r.message.content || "", 1);
        wikiTitleInput.val($(".wiki-title").text()?.trim() || "");
      }

      currentUrl.searchParams.set("editWiki", 1);
      window.history.replaceState({}, "", currentUrl);
    },
  });
}

editor.session.on("change", () => saveDraftLocally());
wikiTitleInput.on("input", () => saveDraftLocally());

function saveDraftLocally() {
  const content = editor.getValue();
  const title = wikiTitleInput.val()?.trim() || "";

  if (content || title) {
    localStorage.setItem(
      `wiki_draft_${wikiPageName}`,
      JSON.stringify({
        content: content,
        title: title,
        timestamp: Date.now(),
      }),
    );
  }
}

function getLocalDraft() {
  const draftKey = `wiki_draft_${wikiPageName}`;
  const draft = localStorage.getItem(draftKey);
  if (draft) {
    try {
      return JSON.parse(draft);
    } catch (e) {
      localStorage.removeItem(draftKey);
      return null;
    }
  }
}

function setLocalDraftinEditor(draft) {
  if (!draft) return;
  editor.setValue(draft.content || "", 1);
  wikiTitleInput.val(draft.title || "");
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
      // Clear draft from localStorage after successful save
      localStorage.removeItem(`wiki_draft_${wikiPageName}`);
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
    discardEditBtn.attr("data-new", true);
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
  validateAndUploadFiles(dataTransfer.files, "drop");
});

editorContainer.addEventListener("paste", function (e) {
  const clipboardData = e.clipboardData;
  if (!clipboardData?.files?.length) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  validateAndUploadFiles(clipboardData.files, "paste");
});

function validateAndUploadFiles(files, event) {
  const allowedTypes = ["image/", "video/mp4", "video/quicktime"];
  const invalidFiles = Array.from(files).filter(
    (file) => !allowedTypes.some((type) => file.type.includes(type)),
  );

  if (invalidFiles.length > 0) {
    const action = event === "paste" ? "paste" : "insert";
    frappe.show_alert({
      message: __(
        `You can only {0} images, videos and GIFs in Markdown fields. Invalid file(s): {1}`,
        [__(action), invalidFiles.map((f) => f.name).join(", ")],
      ),
      indicator: "orange",
    });
    return;
  }

  uploadMedia(
    ["image/*", "video/mp4", "video/quicktime"],
    "Insert Media in Markdown",
    files,
  );
}

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
      uploadMedia(["image/*"], "Insert Image in Markdown");
      break;
    case "video":
      uploadMedia(["video/mp4", "video/quicktime"], "Insert Video in Markdown");
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

function uploadMedia(fileTypes, dialogTitle, files = null) {
  new frappe.ui.FileUploader({
    dialog_title: __(dialogTitle),
    doctype: this.doctype,
    docname: this.docname,
    frm: this.frm,
    files,
    folder: "Home/Attachments",
    disable_file_browser: !files,
    allow_toggle_private: false,
    allow_multiple: true,
    make_attachments_public: true,
    restrictions: {
      allowed_file_types: fileTypes,
    },
    on_success: (file_doc) => {
      if (this.frm && !this.frm.is_new()) {
        this.frm.attachments.attachment_uploaded(file_doc);
      }
      const fileType = file_doc.file_url.split(".").pop().toLowerCase();
      let content;
      let file_url = encodeURI(file_doc.file_url);
      if (["mp4", "mov"].includes(fileType)) {
        content = `\n<video controls width="100%" height="auto"><source src="${file_url}" type="video/${fileType}"></video>`;
      } else {
        const fileName =
          file_doc.file_name || file_doc.file_url.split("/").pop();
        const altText = fileName
          .split(".")
          .slice(0, -1)
          .join(".") // without extension
          .replaceAll("_", " ")
          .replaceAll("-", " ");
        content = `\n![${altText}](${file_url})`;
      }
      editor.session.insert(editor.getCursorPosition(), content);
    },
  });
}

const mdeBoldBtn = document.querySelector('[data-mde-button="bold"]');
const mdeItalicBtn = document.querySelector('[data-mde-button="italic"]');
const mdeHeadingBtn = document.querySelector('[data-mde-button="heading"]');
const mdeQuoteBtn = document.querySelector('[data-mde-button="quote"]');
const mdeOlistBtn = document.querySelector('[data-mde-button="olist"]');
const mdeUlistBtn = document.querySelector('[data-mde-button="ulist"]');
const mdeLinkBtn = document.querySelector('[data-mde-button="link"]');
const mdeImageBtn = document.querySelector('[data-mde-button="image"]');
const mdeVideoBtn = document.querySelector('[data-mde-button="video"]');
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
mdeVideoBtn.addEventListener("click", () => insertMarkdown("video"));
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
