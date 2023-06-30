// Copyright (c) 2023, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Space", {
  refresh(frm) {
    frm.add_web_link(`/${frm.doc.route}`, __("See on website"));

    frm.add_custom_button("Clone Wiki Space", () => {
      frappe.prompt("Enter new Wiki Space's name", ({ value }) => {
        frm
          .call("clone", { new_space_route: value })
          .then((r) => frm.refresh());
      });
    });
  },
});
