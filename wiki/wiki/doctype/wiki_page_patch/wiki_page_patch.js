// Copyright (c) 2021, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on('Wiki Page Patch', {
	refresh: function(frm) {
		$('.wiki-diff').append(frm.doc.diff)
		$('#orignal_preview').append(frm.doc.orignal_preview_store)
		$('#new_preview').append(frm.doc.new_preview_store)
	}
});
