// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Settings", {
  refresh: function (frm) {
    frm.add_web_link("/wiki", __("See on website"));

    frm.set_query("default_wiki_document_print_format", function () {
      return {
        filters: {
          doc_type: "Wiki Document",
          disabled: 0,
        },
      };
    });
  },
});
