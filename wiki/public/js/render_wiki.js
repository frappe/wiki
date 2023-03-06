window.RenderWiki = class RenderWiki extends Wiki {
  constructor(opts) {
    super();
    $("document").ready(() => {
      this.set_darkmode_button();
      if (
        window.location.pathname != "/revisions" &&
        window.location.pathname != "/compare"
      ) {
        this.activate_sidebars();
        this.set_active_sidebar();
        this.set_nav_buttons();
        this.set_toc_highlighter();
        this.scrolltotop();
        this.set_add_item();
        this.add_trash_icon();
        this.set_empty_ul();
        this.set_edit_mode();
      }
    });
  }

  set_toc_highlighter() {
    $(document).ready(function () {
      $(window).scroll(function () {
        if (currentAnchor().not(".no-underline").hasClass("active")) return;
        $(".page-toc a").removeClass("active");
        currentAnchor().addClass("active");
      });
    });

    function tocItem(anchor) {
      return $('[href="' + anchor + '"]');
    }

    function heading(anchor) {
      return $("[id=" + anchor.substr(1) + "]");
    }

    var _anchors = null;
    function anchors() {
      if (!_anchors) {
        _anchors = $(".page-toc a").map(function () {
          return $(this).attr("href");
        });
      }
      return _anchors;
    }

    function currentAnchor() {
      var winY = window.pageYOffset;
      var currAnchor = null;
      anchors().each(function () {
        var y = heading(this).position().top;
        if (y < winY + window.innerHeight * 0.23) {
          currAnchor = this;
          return;
        }
      });
      return tocItem(currAnchor);
    }
  }

  set_nav_buttons() {
    var current_index = -1;

    $(".sidebar-column")
      .find("a")
      .each(function (index) {
        if ($(this).attr("class")) {
          let dish = $(this).attr("class").split(/\s+/)[0];
          if (dish === "active") {
            current_index = index;
          }
        }
      });

    if (current_index > 0) {
      $(".btn.left")[0].href =
        $(".sidebar-column").find("a")[current_index - 1].href;
      $(".btn.left")[0].innerHTML =
        "←" + $(".sidebar-column").find("a")[current_index - 1].innerHTML;
    } else {
      $(".btn.left").hide();
    }

    if (
      current_index >= 0 &&
      current_index < $(".sidebar-column").find("a").length - 1
    ) {
      $(".btn.right")[0].href =
        $(".sidebar-column").find("a")[current_index + 1].href;
      $(".btn.right")[0].innerHTML =
        $(".sidebar-column").find("a")[current_index + 1].innerHTML + "→";
    } else {
      $(".btn.right").hide();
    }
  }

  set_edit_mode() {
    $(".sidebar-item, .sidebar-group").addClass("disabled");

    $(".web-sidebar ul").each(function () {
      new Sortable(this, {
        group: {
          name: "qux",
          put: ["qux"],
          pull: ["qux"],
        },
        filter: ".disabled",
        onUpdate: function () {
          isSidebarChanged = true;
        },
      });
    });

    function toggleEditor() {
      $(".wiki-content").toggleClass("hide");
      $(".edit-wiki-btn").toggleClass("hide");
      $(".wiki-edit-control-btn").toggleClass("hide");
      $(".page-toc").toggleClass("hide");
      $(".wiki-editor").toggleClass("hide");
      $(".wiki-title").toggleClass("hide");
      $(".remove-sidebar-item").toggleClass("hide");
      $(".add-sidebar-group, .add-sidebar-page").toggleClass("hide");
      $(".sidebar-item, .sidebar-group").toggleClass("disabled");
    }

    $(".edit-wiki-btn").on("click", function () {
      // switch to edit mode
      toggleEditor();
    });

    $(".discard-edit-btn").on("click", function () {
      // switch to view mode
      toggleEditor();
    });

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("editWiki") && $(".edit-wiki-btn").length)
      $(".edit-wiki-btn").trigger("click");
  }

  add_trash_icon() {
    const trashIcon = `<div class="text-muted hide remove-sidebar-item small">
      <span class="trash-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </span>
    </div>`;

    $(".sidebar-item > div").each(function (index) {
      $(trashIcon).insertAfter($(this));
    });

    $(".sidebar-group > div").each(function () {
      $(this).append(trashIcon);
    });

    $(".remove-sidebar-item").on("click", function () {
      if (!e) var e = window.event;
      if (e.stopPropagation) e.stopPropagation();

      const type = $(this).parents("li").data("type");
      const route = $(this).parents("li").data("route");
      const title = $(this).parents("li").data("title");

      if (type === "Wiki Page")
        frappe.msgprint({
          title: __("Delete Wiki Page"),
          indicator: "red",
          message: __(
            `Are you sure you want to <b>delete</b> the Wiki Page <b>${title}</b>?`,
          ),
          primary_action: {
            label: "Yes",
            action() {
              frappe.call({
                method:
                  "wiki.wiki.doctype.wiki_page.wiki_page.delete_wiki_page",
                args: {
                  wiki_page_route: route,
                },
                callback: (r) => {
                  if (r.message) {
                    const segments = window.location.pathname.split("/");
                    segments.pop();
                    const wikiInURL = segments.pop() || segments.pop();

                    if (route.substring(1) === wikiInURL)
                      window.location.assign("/wiki");
                    else window.location.reload();
                  }
                },
              });
            },
          },
        });
      else if (type === "Wiki Sidebar")
        frappe.msgprint({
          title: __("Delete Wiki Sidebar Group"),
          indicator: "red",
          message: __(
            `Are you sure you want to <b>delete</b> the Wiki Sidebar Group <b>${title}</b>?<br>This will also delete all the children under it.`,
          ),
          primary_action: {
            label: "Yes",
            action() {
              frappe.call({
                method:
                  "wiki.wiki.doctype.wiki_sidebar.wiki_sidebar.delete_sidebar_group",
                args: {
                  sidebar_group_name: route.substring(1),
                },
                callback: (r) => {
                  if (r.message) {
                    $(`.sidebar-group[data-route='${route}']`).remove();
                    this.hide();
                  }
                },
              });
            },
          },
        });
    });
  }

  set_add_item() {
    $(
      `<div class="add-sidebar-items">
        <div class="text-muted add-sidebar-group hide small">+ Add Group</div>
        <div class="text-muted add-sidebar-page hide small">+ Add Page</div>
      </div>`,
    ).appendTo($(".web-sidebar"));
    var me = this;
    $(".add-sidebar-group").on("click", function () {
      $("#addGroupModal").modal();
    });

    $(".add-group-btn").on("click", () => {
      const route = $("#addGroupModal #route").val();
      const title = $("#addGroupModal #title").val();
      if (route && title) {
        $("#addGroupModal").modal();
        $("#addGroupModal #route").val("");
        $("#addGroupModal #title").val("");
        this.add_wiki_sidebar(route, title);
      }
    });

    $(".add-sidebar-page").on("click", function () {
      const sidebarItems = getSidebarItems();
      const title = "New Wiki Page";

      frappe.call({
        method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
        args: {
          name: $(".wiki-content + input").val(),
          message: `Created ${title}`,
          content: `<p>Wiki Content</p>`,
          type: "Rich Text",
          new: "1",
          title,
          new_sidebar_items: sidebarItems,
          sidebar_edited: true,
        },
        callback: (r) => {
          window.location.href = `/${r.message.route}?editWiki=1`;
        },
        freeze: true,
      });
    });
  }

  add_wiki_sidebar(route, title) {
    let $new_page = this.get_wiki_sidebar_html(route, title);

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
        filter: ".disabled",
        onUpdate: function () {
          isSidebarChanged = true;
        },
      });
    });
  }

  get_wiki_sidebar_html(route, title) {
    return $(`
			<li class="sidebar-group" data-type="Wiki Sidebar"
				data-name="new-sidebar" data-group-name="${route}"
				data-new=1 data-title="${title}" draggable="false">

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
					<span class="h6">${title}</span>
					</div>
					<ul class="list-unstyled hidden" style="min-height:20px;"> </ul>
			</li>
			`);
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
};
