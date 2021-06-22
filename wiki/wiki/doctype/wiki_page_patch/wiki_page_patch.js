// Copyright (c) 2021, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wiki Page Patch", {
  refresh: function (frm) {
    $(".wiki-diff").append(frm.doc.diff);
    $("#orignal_preview").append(frm.doc.orignal_preview_store);
    $("#new_preview").append(frm.doc.new_preview_store);

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
              sidebar_items[sidebar][item].title +
              "></ul>"
          );
        } else {
          $(target).append(
            "<li class=" +
              sidebar_items[sidebar][item].title +
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
		$(".list-unstyled").removeClass("hidden");
    $(".list-unstyled").removeClass("list-unstyled");
    $(".web-sidebar").find("svg").remove();
      });

    
  },
});
