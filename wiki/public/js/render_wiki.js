function setSortable() {
  new Sortable(this, {
    group: {
      name: "qux",
      put: ["qux"],
      pull: ["qux"],
    },
    filter: ".disabled",
    onEnd: function (e) {
      frappe.utils.debounce(() => {
        frappe.call({
          method:
            "wiki.wiki.doctype.wiki_settings.wiki_settings.update_sidebar",
          args: {
            sidebar_items: getSidebarItems(),
          },
        });
      }, 1500)();
    },
    onMove: function (e) {
      if (
        // don't allow groups to nest inside groups
        ($(e.dragged).hasClass("sidebar-group") &&
          !$(e.to).is($(".doc-sidebar .sidebar-items > .list-unstyled"))) ||
        // only allow items to nest inside groups and not root
        ($(e.dragged).hasClass("sidebar-item") &&
          $(e.to).is($(".doc-sidebar .sidebar-items > .list-unstyled")))
      )
        return false;
    },
  });
}

function set_search_params(key = "", value = "") {
  const url = new URL(window.location.href.split("?")[0]);
  if (key && value) url.searchParams.set(key, value);
  window.history.pushState({}, "", url);
}

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
        this.set_url_state();
      }
    });
  }

  set_url_state() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("editWiki") && $(".edit-wiki-btn .icon").length)
      $(".edit-wiki-btn").trigger("click");
    else if (
      urlParams.get("newWiki") &&
      $(
        `.doc-sidebar .sidebar-group[data-title="${urlParams.get(
          "newWiki",
        )}"] .add-sidebar-page`,
      ).length &&
      $(".edit-wiki-btn .icon").length
    ) {
      $(".wiki-content").toggleClass("hide");
      $(".wiki-edit-control-btn").toggleClass("hide");
      $(".page-toc").toggleClass("hide");
      $(".remove-sidebar-item").toggleClass("hide");
      $(".sidebar-item, .sidebar-group").toggleClass("disabled");
      $(".drop-icon").toggleClass("hide");
      $(".add-sidebar-page").toggleClass("hide");
      $(".add-sidebar-group").toggleClass("hide");

      if ($(".from-markdown").is(":visible"))
        $(".new-wiki-editor").toggleClass("hide");

      $(".edit-wiki-btn, .sidebar-edit-mode-btn").toggleClass("hide");
      $(".wiki-title").toggleClass("hide");
    }
    $(".from-markdown").removeClass("hide");
    $(".wiki-footer").toggleClass("hide");
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
    const sidebar_items = $(".sidebar-column").find("a").not(".navbar-brand");

    sidebar_items.each(function (index) {
      if ($(this).attr("class")) {
        let dish = $(this).attr("class").split(/\s+/)[0];
        if (dish === "active") {
          current_index = index;
        }
      }
    });

    if (current_index > 0) {
      $(".btn.left")[0].href = sidebar_items[current_index - 1].href;
      $($(".btn.left p")[1]).text(sidebar_items[current_index - 1].innerText);
    } else {
      $(".btn.left").hide();
    }

    if (current_index >= 0 && current_index < sidebar_items.length - 1) {
      $(".btn.right")[0].href = sidebar_items[current_index + 1].href;
      $($(".btn.right p")[1]).text(sidebar_items[current_index + 1].innerText);
    } else {
      $(".btn.right").hide();
    }
  }

  set_edit_mode() {
    if (hasWikiPageEditPerm == "True") {
      $(".edit-wiki-btn").append(
        `<svg class="icon">
          <use href="#icon-edit"></use>
        </svg>`,
      );
      $(".sidebar-edit-mode-btn").append(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit-3"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        <span class="small">Edit Sidebar</span>`,
      );
    } else $(".edit-wiki-btn, .sidebar-edit-mode-btn").addClass("hide");

    $(".sidebar-item, .sidebar-group").addClass("disabled");

    $(".web-sidebar ul").each(setSortable);

    function toggleEditor(newEditor = false, fromEdit = false) {
      if (fromEdit) {
        $(".wiki-editor").toggleClass("hide");
        $(".new-wiki-editor").toggleClass("hide");
      } else {
        $(".wiki-content").toggleClass("hide");
        $(".wiki-revision-meta").toggleClass("hide");
        $(".wiki-footer").toggleClass("hide");
        $(".wiki-edit-control-btn").toggleClass("hide");
        $(".page-toc").toggleClass("hide");
        $(".remove-sidebar-item").toggleClass("hide");
        $(".sidebar-item, .sidebar-group").toggleClass("disabled");
        $(".drop-icon").toggleClass("hide");
        $(".add-sidebar-page").toggleClass("hide");
        $(".add-sidebar-group").toggleClass("hide");

        // avoid hiding editor when params ?editWiki or ?newWiki
        if ($(".from-markdown").is(":visible"))
          if (newEditor) $(".new-wiki-editor").toggleClass("hide");
          else $(".wiki-editor").toggleClass("hide");

        $(".edit-wiki-btn, .sidebar-edit-mode-btn").toggleClass("hide");
        $(".wiki-title").toggleClass("hide");
      }
    }

    $(".edit-wiki-btn, .sidebar-edit-mode-btn").on("click", function () {
      // switch to edit mode
      toggleEditor();
      $("html").css({ overflow: "hidden" });

      set_search_params("editWiki", "1");
    });

    $(".discard-edit-btn").on("click", function () {
      // switch to view mode
      toggleEditor($(this).data("new"));
      $("html").css({ overflow: "auto" });
      if ($(this).data("new") === true)
        $('.sidebar-item[data-name="new-wiki-page"]').remove();
      set_search_params();
    });

    let active_items = "";
    $(".sidebar-items > .list-unstyled").on(
      "click",
      ".add-sidebar-page",
      function (e) {
        const groupName = $(this).parent().children("span:first-child").text();
        const newWikiPage = $(".sidebar-item[data-name=new-wiki-page]");
        const newSidebarItem = $(`
        <li class="sidebar-item active" data-type="Wiki Page" data-name="new-wiki-page" data-group-name="${groupName}">
          <div>
            <a href="#" class="active">New Wiki Page</a>
          </div>
        </li>
      `);

        if (newWikiPage.length) {
          // a temp new item is already created
          if (newWikiPage.data("group-name") !== groupName) {
            // when new item is created in a different group as earlier
            newSidebarItem.appendTo(
              $(this).parent().parent().children(".list-unstyled"),
            );
            set_search_params("newWiki", groupName);
          } else {
            // when new item is removed (discarding it) by clicking on + again
            active_items.each(function () {
              $(this).toggleClass("active");
            });

            toggleEditor(
              true,
              $(".wiki-editor, .new-wiki-editor").is(":visible"),
            );
            set_search_params();
          }
          newWikiPage.remove();
        } else {
          // fresh new item
          active_items = $(
            ".sidebar-item.active, .sidebar-item.active .active",
          ).removeClass("active");

          newSidebarItem.appendTo(
            $(this).parent().parent().children(".list-unstyled"),
          );
          toggleEditor(
            true,
            $(".wiki-editor, .new-wiki-editor").is(":visible"),
          );
          set_search_params("newWiki", groupName);
        }

        $(this).parent().parent().each(setSortable);
        e.stopPropagation();
      },
    );
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

    $(".sidebar-items > .list-unstyled").on(
      "click",
      ".remove-sidebar-item",
      function (e) {
        e.stopPropagation();

        const sidebar_item = $($(this).parents("li")[0]);
        const route = sidebar_item.data("route");
        const title = sidebar_item.data("title");

        const dialog = frappe.msgprint({
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
                    sidebar_item.remove();

                    frappe.show_alert({
                      message: `Wiki Page <b>${title}</b> deleted`,
                      indicator: "green",
                    });
                    dialog.hide();
                  }
                },
              });
            },
          },
        });
      },
    );
  }

  set_add_item() {
    var me = this;
    $(".add-sidebar-group").on("click", function () {
      $("#addGroupModal").modal();
    });

    $(".add-group-btn").on("click", () => {
      const title = $("#addGroupModal #title").val();
      if (title) {
        $("#addGroupModal").modal();
        $("#addGroupModal #title").val("");
        this.add_wiki_sidebar(title);
      }
    });
  }

  add_wiki_sidebar(title) {
    let $new_page = this.get_wiki_sidebar_html(title);

    $new_page.appendTo(
      $(".doc-sidebar .sidebar-items")
        .children(".list-unstyled")
        .not(".hidden")
        .first(),
    );

    $(".web-sidebar ul").each(setSortable);
  }

  get_wiki_sidebar_html(title) {
    return $(`
			<li class="sidebar-group" data-type="Wiki Sidebar"
				data-name="new-sidebar" data-new=1 data-title="${title}" draggable="false">
				<div class="collapsible">
					<span class="h6">${title}</span>
          <span class='drop-icon hide'>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 10L12 14L16 10" stroke="#4C5A67" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
          </span>
          <span class='add-sidebar-page'>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </span>
        </div>
        <ul class="list-unstyled" style="min-height:20px;"> </ul>
			</li>
			`);
  }

  set_empty_ul() {
    $(".collapsible").each(function () {
      if ($(this).parent().find("ul").length == 0) {
        $(this)
          .parent()
          .append(
            $(`<ul class="list-unstyled" style="min-height:20px;"> </ul`),
          );
      }
    });
  }
};
