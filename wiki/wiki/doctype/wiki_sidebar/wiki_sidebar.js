// Copyright (c) 2021, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Sidebar", {
  refresh: function (frm) {
    frm.set_query("type", "sidebar_items", function () {
      return {
        filters: {
          name: ["in", ["Wiki Page", "Wiki Sidebar"]],
        },
      };
    });
  },
});
