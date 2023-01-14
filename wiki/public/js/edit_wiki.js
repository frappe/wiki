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
          $(".doc-sidebar").empty().append(result.message);
          this.activate_sidebars();
          this.set_active_sidebar();
          this.set_empty_ul();
          this.set_sortable();
          this.set_add_item();
          this.scrolltotop();
        });
    });
  }

  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
      const active_class = "active";
      let page_href = window.location.pathname;
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
  }

  set_empty_ul() {
    $(".collapsible").each(function () {
      if ($(this).parent().find("ul").length == 0) {
        $(this)
          .parent()
          .append(
            $(
              `<ul class="list-unstyled hidden" style="min-height:20px;"> </ul`,
            ),
          );
      }
    });
  }

  set_sortable() {
    $(".web-sidebar ul").each(function () {
      new Sortable(this, {
        group: {
          name: "qux",
          put: ["qux"],
          pull: ["qux"],
        },
      });
    });
  }

  set_add_item() {
    $(`<div class="text-muted add-sidebar-item small">+ Add Group</div>
      <div class="text-muted remove-sidebar-item small">- Remove Group</div>
			<div class="text-muted small mt-3"><i>Drag items to re-order</i></div>`).appendTo(
      $(".web-sidebar"),
    );
    var me = this;
    $(".add-sidebar-item").click(function () {
      var dfs = me.get_add_new_item_dialog_fields();

      var dialog = new frappe.ui.Dialog({
        title: "Add Group to Sidebar",
        fields: dfs,
        primary_action: function (fields) {
          me.add_wiki_sidebar(fields);
          dialog.hide();
        },
      });
      dialog.show();
    });

    $(".remove-sidebar-item").click(async function () {
      const getAutoCompleteOptions = async () => {
        return new Promise((resolve) => {
          frappe.call({
            method:
              "wiki.wiki.doctype.wiki_sidebar.wiki_sidebar.get_sidebar_group_names",
            callback: function (r) {
              resolve(r.message);
            },
          });
        });
      };

      let dialog = new frappe.ui.Dialog({
        title: "Remove Group from Sidebar",
        fields: [
          {
            fieldname: "name",
            label: "Name",
            fieldtype: "Autocomplete",
            options: await getAutoCompleteOptions(),
          },
        ],
        primary_action: function (fields) {
          if (fields.name === "wiki")
            frappe.throw(__("You shouldn't delete the <b>wiki</b> Sidebar"));
          else
            frappe.confirm(
              `Are you sure you want to delete the Wiki Sidebar Group ${fields.name}?`,
              () => {
                frappe.call({
                  method:
                    "wiki.wiki.doctype.wiki_sidebar.wiki_sidebar.delete_sidebar_group",
                  args: {
                    sidebar_group_name: fields.name,
                  },
                  callback: (r) => {
                    if (r.message) window.location.reload();
                  },
                });
              },
            );
          dialog.hide();
        },
      });
      dialog.show();
    });
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

  add_wiki_sidebar(fields) {
    let $new_page = this.get_wiki_sidebar_html(fields);

    $new_page.appendTo(
      $(".doc-sidebar .sidebar-items")
        .children(".list-unstyled")
        .not(".hidden")
        .first(),
    );

    $(".web-sidebar ul").each(function () {
      new Sortable(this, {
        group: {
          name: "qux",
          put: ["qux"],
          pull: ["qux"],
        },
      });
    });
  }

  get_wiki_sidebar_html(fields) {
    return $(`
			<li class="sidebar-group" data-type="Wiki Sidebar"
				data-name="new-sidebar" data-group-name="${fields.route}"
				data-new=1 data-title="${fields.title}" draggable="false">

				<div class="collapsible">
					<span class="drop-icon hidden">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
								xmlns="http://www.w3.org/2000/svg">
								<path d="M8 10L12 14L16 10" stroke="#4C5A67"
								stroke-miterlimit="10" stroke-linecap="round"
								stroke-linejoin="round"></path>
							</svg>
					</span>

					<span class="drop-left">
							<svg width="24" height="24" viewBox="0 0 24 24"
								fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M10 16L14 12L10 8" stroke="#4C5A67"
								stroke-linecap="round" stroke-linejoin="round"></path>
							</svg>
					</span>
					<span class="h6">${fields.title}</span>
					</div>
					<ul class="list-unstyled hidden" style="min-height:20px;"> </ul>
			</li>
			`);
  }
};
