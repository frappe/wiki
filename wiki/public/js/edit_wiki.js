window.EditWiki = class EditWiki {
  constructor() {
    frappe.provide('frappe.ui.keys');
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
          if ($('[name="new"]').first().val()) {
            this.add_new_link();
          }
        });
    });
  }

  add_new_link() {
    let $new_page = $(`
			<li class="sidebar-item" data-type="Wiki Page" data-name="new" data-new=1 ><div>
					<div>
							<a href="#" class="green">New Wiki Page</a>
					</div></div>
					</li>
		`);

    $new_page.appendTo(
      $(".doc-sidebar .sidebar-items")
        .children(".list-unstyled")
        .not(".hidden")
        .first()
    );
  }

  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
			const active_class = "active";
			const non_active_class = "";
			let page_href = window.location.pathname;
			if (page_href.indexOf("#") !== -1) {
				page_href = page_href.slice(0, page_href.indexOf("#"));
			}
			if (page_href.includes($(this).data('route'))  ) {
				$(this).addClass(active_class);
				$(this).find('a').addClass(active_class);
			}
		});
		// scroll the active sidebar item into view
		let active_sidebar_item = $(".sidebar-item.active");
		if (active_sidebar_item.length > 0) {
			active_sidebar_item
				.get(0)
				.scrollIntoView(true, {
					behavior: "smooth",
					block: "nearest",
				});
		}
    
  }

  toggle_sidebar(event) {
    $(event.currentTarget).parent().find("ul").toggleClass("hidden");
    $(event.currentTarget).find(".drop-icon").toggleClass("hidden");
    $(event.currentTarget).find(".drop-left").toggleClass("hidden");
    event.stopPropagation();
  }

  set_active_sidebar() {
    $(".doc-sidebar,.web-sidebar").on(
      "click",
      ".collapsible",
      this.toggle_sidebar
    );
    $(".sidebar-group").children("ul").addClass("hidden");
    $(".sidebar-item.active")
      .parents(" .web-sidebar .sidebar-group>ul")
      .removeClass("hidden");
    const sidebar_groups = $(".sidebar-item.active").parents(
      ".web-sidebar .sidebar-group"
    );
    sidebar_groups.each(function () {
      $(this).children(".collapsible").find(".drop-left").addClass("hidden");
    });
    sidebar_groups.each(function () {
      $(this).children(".collapsible").find(".drop-icon").removeClass("hidden");
    });
  }

  set_empty_ul() {
    $(".collapsible").each(function () {
      if ($(this).parent().find("ul").length == 0) {
        $(this)
          .parent()
          .append(
            $(`<ul class="list-unstyled hidden" style="min-height:20px;"> </ul`)
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
    $(`<div class="text-muted add-sidebar-item">+ Add Item</div>`).appendTo(
      $(".web-sidebar")
    );

    $(".add-sidebar-item").click(function () {
      var dfs = [
        {
          fieldname: "type",
          label: "Add Type",
          fieldtype: "Autocomplete",
          options: ["Add Wiki Page", "New Wiki Sidebar"],
        },
        {
          fieldname: "wiki_page",
          label: "Wiki Page",
          fieldtype: "Link",
          options: "Wiki Page",
          depends_on: "eval: doc.type=='Add Wiki Page'",
          mandatory_depends_on: "eval: doc.type=='Add Wiki Page'",
        },
        {
          fieldname: "route",
          label: "Name",
          fieldtype: "Data",
          depends_on: "eval: doc.type=='New Wiki Sidebar'",
          mandatory_depends_on: "eval: doc.type=='New Wiki Sidebar'",
        },
        {
          fieldname: "title",
          label: "Title",
          fieldtype: "Data",
          depends_on: "eval: doc.type=='New Wiki Sidebar'",
          mandatory_depends_on: "eval: doc.type=='New Wiki Sidebar'",
        },
      ];

      var dialog = new frappe.ui.Dialog({
        fields: dfs,
        primary_action: function (fields) {
          if (fields.type == "Add Wiki Page") {
            frappe.call({
              method: "frappe.client.get_value",
              args: {
                doctype: "Wiki Page",
                fieldname: "title",
                filters: fields.wiki_page,
              },
              callback: function (r) {
                let $new_page = $(`
												<li class="sidebar-item" data-type="Wiki Page" data-name="${fields.wiki_page}" data-new=1 ><div>
														<div style="align-items: center;">
																<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" 
																		class="bi bi-dot" viewBox="0 0 16 16">
																		<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"></path>
																</svg>
														</div>
														<div>
																<a href="#" class="green" >
																		${r.message.title}
																</a>
														</div></div>
														</li>
												`);

                $new_page.appendTo(
                  $(".doc-sidebar .sidebar-items")
                    .children(".list-unstyled")
                    .not(".hidden")
                    .first()
                );
              },
            });
          } else {
            let $new_page = $(`
								<li class="sidebar-group" data-type="Wiki Sidebar" data-name="new-sidebar" data-group-name="${fields.route}" 
								data-new=1 data-title="${fields.title}" draggable="false">
										<div class="collapsible">
										<span class="drop-icon hidden">
												<!-- <svg class="icon icon-xs">
														<use href="#icon-small-down"></use>
												</svg> -->
												<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
														<path d="M8 10L12 14L16 10" stroke="#4C5A67" stroke-miterlimit="10" 
														stroke-linecap="round" stroke-linejoin="round"></path>
												</svg>
										</span>
										<span class="drop-left">
												<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
														<path d="M10 16L14 12L10 8" stroke="#4C5A67" stroke-linecap="round" stroke-linejoin="round"></path>
												</svg>
										</span>
										<span class="h6">${fields.title}</span>

										</div>
										<ul class="list-unstyled hidden" style="min-height:20px;"> </ul
								</li>
								`);

            $new_page.appendTo(
              $(".doc-sidebar .sidebar-items")
                .children(".list-unstyled")
                .not(".hidden")
                .first()
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
          dialog.hide();
        },
      });
      dialog.show();
    });
  }
};
