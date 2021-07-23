// Copyright (c) 2021, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Page Patch", {
	refresh: function (frm) {


		frappe.call({
			method: "wiki.wiki.doctype.wiki_page.wiki_page.preview",
			args: {
				content: frm.doc.new_code,
				name: frm.doc.wiki_page,
				new: frm.doc.new ? 1 : "",
				type: 'markdown',
				diff_css:1
			},
			callback: (r) => {
				if (r.message) {
					$("#orignal_preview").append(r.message.orignal_preview);
					$("#new_preview").append(r.message.html);

					if (!frm.doc.new) {
						$(".wiki-diff").append(r.message.diff);
					}
				}
			},
		});


		const lis = $("#new_sidebar");
		const sidebar_items = JSON.parse(cur_frm.doc.new_sidebar_items);
		lis.empty();
		for (let sidebar in sidebar_items) {
			for (let item in sidebar_items[sidebar]) {
				let class_name = ("." + sidebar).replaceAll("/", "\\/");
				let target = lis.find(class_name);
				if (!target.length) {
					target = $("#new_sidebar");
				}
				if (sidebar_items[sidebar][item].type == "Wiki Sidebar") {
					$(target).append(
						"<li>" +
							sidebar_items[sidebar][item].title +
							"</li>" +
							"<ul class=" +
							sidebar_items[sidebar][item].group_name +
							"></ul>"
					);
				} else {
					$(target).append(
						"<li class=" +
							sidebar_items[sidebar][item].group_name +
							">" +
							sidebar_items[sidebar][item].title +
							"</li>"
					);
				}
			}
		}

		frappe
			.call("wiki.wiki.doctype.wiki_page.wiki_page.get_sidebar_for_page", {
				wiki_page: frm.doc.wiki_page,
			})
			.then((result) => {
				$("#old_sidebar").empty().append(result.message);
				$("#old_sidebar .h6").removeClass("h6");
				$(".form-section .list-unstyled").removeClass("hidden");
				$(".form-section .list-unstyled").removeClass("list-unstyled");
				$(".form-section .web-sidebar").find("svg").remove();
			});

		
	},
});
