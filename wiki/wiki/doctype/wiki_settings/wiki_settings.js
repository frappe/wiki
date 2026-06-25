// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Settings", {
  refresh: function (frm) {
    frm.add_web_link("/wiki", __("See on website"));

    frm.add_custom_button(__("Create GitHub App"), () => {
      // Manifest flow: GitHub creates the App and posts its credentials back
      // to /github/manifest_redirect, which writes them into these fields.
      window.open("/github/new_app", "_blank");
    });
  },
});
