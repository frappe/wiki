// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Settings", {
  refresh: function (frm) {
    frm.add_web_link("/wiki", __("See on website"));

    frm.add_custom_button("Clear Wiki Page Cache", () => {
      frm.call({
        method: "clear_wiki_page_cache",
        callback: (r) => {
          if (r.message) {
            frappe.show_alert({
              message: "Wiki Page Cache Cleared",
              indicator: "blue",
            });
          }
        },
      });
    });
  },

  onload: function (frm) {
    frm.set_query("default_wiki_space", function () {
      return {
        query: "wiki.wiki.doctype.wiki_settings.wiki_settings.get_all_spaces",
      };
    });
  },

  onload_post_render: function (frm) {
    frm.trigger("set_parent_label_options");
  },

  set_parent_label_options: function (frm) {
    frm.fields_dict.navbar.grid.update_docfield_property(
      "parent_label",
      "options",
      frm.events.get_parent_options(frm, "navbar"),
    );
  },

  get_parent_options: function (frm, table_field) {
    var items = frm.doc[table_field] || [];
    var main_items = [""];
    for (var i in items) {
      var d = items[i];
      if (!d.url && d.label) {
        main_items.push(d.label);
      }
    }
    return main_items.join("\n");
  },
});

frappe.ui.form.on("Top Bar Item", {
  navbar_delete(frm) {
    frm.events.set_parent_label_options(frm);
  },

  navbar_add(frm, cdt, cdn) {
    frm.events.set_parent_label_options(frm);
  },

  parent_label: function (frm, doctype, name) {
    frm.events.set_parent_label_options(frm);
  },

  url: function (frm, doctype, name) {
    frm.events.set_parent_label_options(frm);
  },

  label: function (frm, doctype, name) {
    frm.events.set_parent_label_options(frm);
  },
});
