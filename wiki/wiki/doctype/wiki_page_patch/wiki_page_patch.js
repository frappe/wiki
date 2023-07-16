// Copyright (c) 2021, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Page Patch", {
  refresh: function (frm) {
    $('[data-fieldname="orignal_code"] pre')
      .parent(".like-disabled-input")
      .html(frm.doc.orignal_code);
    $('[data-fieldname="new_code"] pre')
      .parent(".like-disabled-input")
      .html(frm.doc.new_code);

    if (!frm.doc.new && !frm.doc.__unsaved)
      frappe.call({
        method: "wiki.wiki.doctype.wiki_page.wiki_page.preview",
        args: {
          original_code: frm.doc.orignal_code,
          new_code: frm.doc.new_code,
          name: frm.doc.wiki_page,
        },
        callback: (r) => {
          if (r.message) {
            $(".wiki-diff").append(r.message);
            $(".wiki-diff").append(
              `<style>
                del {
                    background-color: #fee2e2;
                    text-decoration: none;
                }
                ins {
                    background-color:  #dcfce7;
                    text-decoration: none;
                }
             </style>`,
            );
          }
        },
      });
  },
});
