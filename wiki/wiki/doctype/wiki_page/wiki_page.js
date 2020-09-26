// Copyright (c) 2020, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Page", {
	refresh: function (frm) {
		frm.add_custom_button("Revisions", () =>
			frappe.set_route("List", "Wiki Page Revision", {
				wiki_page: frm.doc.name,
			})
		);
	},
});
