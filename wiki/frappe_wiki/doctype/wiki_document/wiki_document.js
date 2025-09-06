// Copyright (c) 2025, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on('Wiki Document', {
	refresh(frm) {
		if (frm.doc.is_published) {
			frm.add_web_link(`/${frm.doc.route}`, 'View in Website');
		}
	},
});
