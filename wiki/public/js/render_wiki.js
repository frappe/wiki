function setSortable() {
  new Sortable(this, {
    group: {
      name: "qux",
      put: ["qux"],
      pull: ["qux"],
    },
    filter: ".disabled",
    onUpdate: function (e) {
      isSidebarChanged = true;
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
    if (hasSidebarEditPerm == "True")
      $(".sidebar-edit-mode-btn").append(
        `<svg class="icon sidebar-edit-mode-pencil">
            <use href="#icon-edit"></use>
          </svg>
          <span class="text-muted small">Edit Sidebar</span>`,
      );

    if (hasWikiPageEditPerm == "True")
      $(".edit-wiki-btn").append(
        `<svg class="icon">
          <use href="#icon-edit"></use>
        </svg>`,
      );

    $(".sidebar-item, .sidebar-group").addClass("disabled");

    $(".web-sidebar ul").each(setSortable);

    function toggleSidebarEditMode() {
      $(".remove-sidebar-item").toggleClass("hide");
      $(".add-sidebar-items").toggleClass("hide");
      $(".sidebar-item, .sidebar-group").toggleClass("disabled");
      $(".sidebar-edit-mode-btn").toggleClass("hide");
    }

    function toggleEditor(newEditor = false) {
      $(".wiki-content").toggleClass("hide");
      $(".edit-wiki-btn").toggleClass("hide");
      $(".wiki-edit-control-btn").toggleClass("hide");
      $(".page-toc").toggleClass("hide");
      if (newEditor) $(".new-wiki-editor").toggleClass("hide");
      else $(".wiki-editor").toggleClass("hide");
      $(".wiki-title").toggleClass("hide");
    }

    let sidebarHTML;
    $(".sidebar-edit-mode-btn").on("click", function () {
      // sidebar edit mode
      toggleSidebarEditMode();
      sidebarHTML = $(".doc-sidebar .sidebar-items > .list-unstyled").html();
    });

    $(".discard-sidebar").on("click", function () {
      // revert sidebar order when clicking on discard
      $(".doc-sidebar .sidebar-items > .list-unstyled > *").remove();
      $(".doc-sidebar .sidebar-items > .list-unstyled").append(sidebarHTML);
      $(".web-sidebar ul").each(setSortable);
      toggleSidebarEditMode();
    });

    $(".save-sidebar").on("click", function () {
      // TODO: separate page update with sidebar update
      frappe.call({
        method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
        args: {
          name: $(".wiki-content + input").val(),
          message: `Edited Sidebar`,
          content: `<div markdown="1">${$(".ProseMirror")
            .html()
            .replace(/<h1>.*?<\/h1>/, "")}</div>`,
          title: $(".wiki-title").text(),
          new_sidebar_items: getSidebarItems(),
          sidebar_edited: true,
        },
        callback: (r) => {
          window.location.href = `/${r.message.route}`;
        },
        freeze: true,
      });
    });

    $(".edit-wiki-btn").on("click", function () {
      // switch to edit mode
      toggleEditor();
    });

    $(".discard-edit-btn").on("click", function () {
      // switch to view mode
      toggleEditor($(this).data("new"));
    });

    $(".add-sidebar-page").on("click", function () {
      toggleEditor(true);
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

    $(".remove-sidebar-item").on("click", function () {
      if (!e) var e = window.event;
      if (e.stopPropagation) e.stopPropagation();

      const type = $(this).parents("li").data("type");
      const route = $(this).parents("li").data("route");
      const title = $(this).parents("li").data("title");
      const currentPath = window.location.href.split("?")[0];

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
                    if (currentPath.includes(route))
                      window.location.assign(`/`);
                    else window.location.assign(`${currentPath}?editWiki=1`);
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
      `<div class="add-sidebar-items hide">
        <div class="text-muted add-sidebar-group small">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add Group</span>
        </div>
        <div class="text-muted add-sidebar-page small">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add Page</span>
        </div>
        <div class="text-muted discard-sidebar small">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Discard</span>
        </div>
        <div class="text-muted save-sidebar small">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-save"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          <span>Save</span>
        </div>
      </div>`,
    ).appendTo($(".web-sidebar"));
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
