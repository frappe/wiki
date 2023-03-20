// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Settings", {
  refresh: function (frm) {
    frm.add_web_link("/wiki", __("See on website"));
  },

  onload_post_render: function (frm) {
    frm.trigger("set_parent_label_options");
    frm.trigger("set_parent_label_options_footer");
  },

  set_parent_label_options: function (frm) {
    frm.fields_dict.navbar.grid.update_docfield_property(
      "parent_label",
      "options",
      frm.events.get_parent_options(frm, "navbar"),
    );
  },

  set_parent_label_options_footer: function (frm) {
    frm.fields_dict.footer_items.grid.update_docfield_property(
      "parent_label",
      "options",
      frm.events.get_parent_options(frm, "footer_items"),
    );
  },

  set_parent_options: function (frm, doctype, name) {
    var item = frappe.get_doc(doctype, name);
    if (item.parentfield === "navbar_items") {
      frm.trigger("set_parent_label_options");
    } else if (item.parentfield === "footer_items") {
      frm.trigger("set_parent_label_options_footer");
    }
  },

  get_parent_options: function (frm, table_field) {
    var items = frm.doc[table_field] || [];
    console.log(items);
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
  navbar_items_delete(frm) {
    frm.events.set_parent_label_options(frm);
  },

  footer_items_add(frm, cdt, cdn) {
    frappe.model.set_value(cdt, cdn, "right", 0);
  },

  footer_items_delete(frm) {
    frm.events.set_parent_label_options_footer(frm);
  },

  parent_label: function (frm, doctype, name) {
    frm.events.set_parent_options(frm, doctype, name);
  },

  url: function (frm, doctype, name) {
    frm.events.set_parent_options(frm, doctype, name);
  },

  label: function (frm, doctype, name) {
    frm.events.set_parent_options(frm, doctype, name);
  },
});
