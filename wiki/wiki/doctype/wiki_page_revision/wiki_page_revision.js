// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Page Revision", {
  refresh: function (frm) {
    $('[data-fieldname="content"] pre')
      .parent(".like-disabled-input")
      .html(frm.doc.content);
  },
});
