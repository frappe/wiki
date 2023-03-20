window.EditWiki = class EditWiki extends Wiki {
  constructor() {
    super();
    frappe.provide("frappe.ui.keys");
    $("document").ready(() => {
      frappe
        .call("wiki.wiki.doctype.wiki_page.wiki_page.get_sidebar_for_page", {
          wiki_page: $('[name="wiki_page"]').val(),
        })
        .then((result) => {
          this.set_darkmode_button();
          $(".doc-sidebar").empty().append(result.message);
          this.activate_sidebars();
          this.set_active_sidebar();
          this.set_empty_ul();
          this.scrolltotop();
        });
    });
  }

  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
      const active_class = "active";
      let page_href = decodeURIComponent(window.location.pathname);
      if (page_href.indexOf("#") !== -1) {
        page_href = page_href.slice(0, page_href.indexOf("#"));
      }
      if (
        page_href.split("/").slice(0, -1).join("/") == $(this).data("route")
      ) {
        if ($('[name="new"]').first().val()) {
          $(`
					<li class="sidebar-item active" data-type="Wiki Page" data-name="new-wiki-page" data-new=1>
						<div><div>
							<a href="#"  class ='active'>New Wiki Page</a>
						</div></div>
					</li>
				`).insertAfter($(this));
        } else {
          $(this).addClass(active_class);
          $(this).find("a").addClass(active_class);
        }
      }
    });
    // scroll the active sidebar item into view
    let active_sidebar_item = $(".sidebar-item.active");
    if (active_sidebar_item.length > 0) {
      active_sidebar_item.get(0).scrollIntoView(true, {
        behavior: "smooth",
        block: "nearest",
      });
    }

    // avoid active sidebar item to be hidden under logo
    let web_sidebar = $(".web-sidebar");
    if (web_sidebar.length > 0) {
      web_sidebar.get(0).scrollBy({
        top: -100,
        behavior: "smooth",
      });
    }
  }

  get_add_new_item_dialog_fields() {
    return [
      {
        fieldname: "route",
        label: "Route",
        fieldtype: "Data",
        mandatory_depends_on: true,
      },
      {
        fieldname: "title",
        label: "Title",
        fieldtype: "Data",
        mandatory_depends_on: true,
      },
    ];
  }
};
