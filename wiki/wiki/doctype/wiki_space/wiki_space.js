// Copyright (c) 2023, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Space", {
  refresh(frm) {
    frm.add_web_link(`/${frm.doc.route}`, __("See on website"));

    frm.add_custom_button("Clone Wiki Space", () => {
      frappe.prompt("Enter new Wiki Space's route", ({ value }) => {
        frm.call("clone_wiki_space_in_background", { new_space_route: value });
      });
    });
  },

  onload_post_render: function (frm) {
    frm.trigger("set_parent_label_options");
  },

  set_parent_label_options: function (frm) {
    frm.fields_dict.navbar_items.grid.update_docfield_property(
      "parent_label",
      "options",
      frm.events.get_parent_options(frm, "navbar_items"),
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
