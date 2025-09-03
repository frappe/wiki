import HtmlDiff from "htmldiff-js";

function setSortable() {
  if (window.innerWidth < 768) {
    return;
  }
  new Sortable(this, {
    group: {
      name: "qux",
      put: ["qux"],
      pull: ["qux"],
    },
    swapThreshold: 0.7,
    filter: ".non-draggable",
    onEnd: function (e) {
      frappe.utils.debounce(() => {
        frappe.call({
          method: "wiki.wiki.doctype.wiki_space.wiki_space.update_sidebar",
          args: {
            sidebar_items: getSidebarItems(),
          },
        });
      }, 1500)();

      // whitespace cleanup to display warning message for empty groups
      if ($(e.from).children("li").length === 0) $(e.from).empty();
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

function toggleSidebarEditor() {
  $(".sidebar-item, .sidebar-group").toggleClass("non-draggable");
  $(".drop-icon").toggleClass("hide");
  $(".add-sidebar-page").toggleClass("hide");
  $(".sidebar-edit-mode-btn").toggleClass("hide");
  $(".add-sidebar-group, .sidebar-view-mode-btn").toggleClass("hide");
  $(".remove-sidebar-item").toggleClass("hide");

  if ($(".sidebar-edit-mode-btn").hasClass("hide")) {
    $(".sidebar-group div, .sidebar-item, .sidebar-item a")
      .not(".remove-sidebar-item")
      .css("cursor", "grab");
    $(".sidebar-item a").removeAttr("href");
  } else {
    $(".sidebar-group div, .sidebar-item a").css("cursor", "pointer");
    $(".sidebar-item").css("cursor", "default");
    $(".sidebar-item").each(function () {
      $(this)
        .find("a")
        .attr("href", `/${$(this).data("route")}`);
    });
  }
}

function toggleEditor() {
  $(".wiki-content").toggleClass("hide");
  $(".wiki-page-meta").toggleClass("hide");
  $(".wiki-footer").toggleClass("hide");
  $(".page-toc").toggleClass("hide");

  // avoid hiding editor when params ?editWiki or ?newWiki
  if ($(".from-markdown").is(":visible")) {
    $(".wiki-editor").toggleClass("hide");
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("editWiki") || urlParams.get("newWiki")) {
      $(".from-markdown").toggleClass("hide");
    }
  }

  $(".wiki-title").toggleClass("hide");
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
        this.add_link_to_headings();
        this.activate_sidebars();
        this.set_active_sidebar();
        this.set_nav_buttons();
        this.set_toc();
        this.set_last_updated_date();
        this.scrolltotop();
        this.set_add_item();
        this.add_trash_icon();
        this.set_empty_ul();
        this.set_edit_mode();
        this.set_url_state();
        this.set_revisions();
        this.add_click_to_copy();
        this.setup_feedback();
        this.setup_page_settings();
      }
    });
  }

  set_url_state() {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get("editWiki") && $(".wiki-options").length) {
      toggleEditor();
    } else if (urlParams.get("newWiki")) {
      toggleEditor();

      if (
        !$(
          `.doc-sidebar .sidebar-group[data-title="${urlParams.get(
            "newWiki",
          )}"] .add-sidebar-page`,
        ).length
      ) {
        this.add_wiki_sidebar(urlParams.get("newWiki"));

        $(
          $(
            `.sidebar-items > .list-unstyled .h6:contains(${urlParams.get(
              "newWiki",
            )}) + .add-sidebar-page`,
          )[0],
        ).trigger("click");
      } else
        $(
          $(
            `.sidebar-items > .list-unstyled .h6:contains(${urlParams.get(
              "newWiki",
            )}) + .add-sidebar-page`,
          )[1],
        ).trigger("click");
    }
  }

  set_nav_buttons() {
    var current_index = -1;
    const sidebar_items = $(".sidebar-column").find("a").not(".navbar-brand");

    sidebar_items.each(function (index) {
      if ($(this).attr("class")) {
        const hasActiveClass = $(this)
          .attr("class")
          .split(/\s+/)
          .includes("active");
        if (hasActiveClass) {
          current_index = index;
        }
      }
    });

    if (current_index > 0) {
      $(".btn.left")[0].href = sidebar_items[current_index - 1].href;
      $($(".btn.left p")[1]).text(sidebar_items[current_index - 1].innerText);
    } else {
      $(".btn.left").addClass("hide");
    }

    if (current_index >= 0 && current_index < sidebar_items.length - 1) {
      $(".btn.right")[0].href = sidebar_items[current_index + 1].href;
      $($(".btn.right p")[1]).text(sidebar_items[current_index + 1].innerText);
    } else {
      $(".btn.right").addClass("hide");
    }
  }

  set_edit_mode() {
    $(".sidebar-item, .sidebar-group").addClass("non-draggable");

    $(".web-sidebar ul").each(setSortable);

    frappe.call({
      method: "wiki.wiki.doctype.wiki_page.wiki_page.has_edit_permission",
      args: {},
      callback: (r) => {
        const urlParams = new URLSearchParams(window.location.search);
        if (
          r.message &&
          !(urlParams.get("editWiki") || urlParams.get("newWiki"))
        )
          $(".sidebar-edit-mode-btn, .edit-wiki-btn").removeClass("hide");
      },
    });

    $(".sidebar-edit-mode-btn, .sidebar-view-mode-btn").on(
      "click",
      function () {
        if (frappe.session.user === "Guest") {
          window.location.assign(
            `/login?redirect-to=${window.location.pathname}`,
          );
        } else {
          toggleSidebarEditor();
        }
      },
    );

    $(".edit-wiki-btn").on("click", function () {
      if (frappe.session.user === "Guest")
        window.location.assign(
          `/login?redirect-to=${window.location.pathname}`,
        );
      else {
        const urlParams = new URLSearchParams(window.location.search);
        // switch to edit mode
        toggleEditor();

        $(".admin-banner").addClass("hide");

        if (!urlParams.get("editWiki")) set_search_params("editWiki", "1");
      }
    });

    $(".discard-edit-btn").on("click", () => {
      const discardDialog = frappe.msgprint({
        title: __("Discard edits"),
        indicator: "red",
        message: __(`Are you sure you want to <b>discard</b> the changes?`),
        primary_action: {
          label: "Yes",
          action() {
            toggleEditor();
            $('.sidebar-item[data-name="new-wiki-page"]').remove();
            set_search_params();
            discardDialog.hide();
          },
        },
      });
    });

    $(".add-wiki-btn").on("click", () => {
      const groupName = $(".sidebar-item.active").data("group-name");
      $(".edit-wiki-btn").trigger("click");
      $(
        `.doc-sidebar .add-sidebar-page[data-group-name="${groupName}"]`,
      ).trigger("click");
    });

    let active_items = "";
    $(".sidebar-items > .list-unstyled").on(
      "click",
      ".add-sidebar-page",
      function (e) {
        const urlParams = new URLSearchParams(window.location.search);
        const groupName = $(this).parent().children("span:first-child").text();
        const newWikiPage = $(".sidebar-item[data-name=new-wiki-page]");
        const newSidebarItem = $(`
        <li class="sidebar-item sidebar-group-item active" data-type="Wiki Page" data-name="new-wiki-page" data-group-name="${groupName}">
          <div>
            <a href="#">New Wiki Page</a>
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
            if (urlParams.get("newWiki") !== groupName)
              set_search_params("newWiki", groupName);
          } else {
            // when new item is removed (discarding it) by clicking on + again
            active_items.each(function () {
              $(this).toggleClass("active");
            });

            toggleEditor();
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
          if (!$(".wiki-editor").is(":visible")) toggleEditor();
          if (urlParams.get("newWiki") !== groupName)
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

  set_revisions() {
    const initial_content = $(".revision-content").html().trim();
    let revisions = [];
    let currentRevisionIndex = 1;

    // set initial revision
    if (initial_content !== "<h3>No Revisions</h3>") {
      $(".revision-content")[0].innerHTML = HtmlDiff.execute(
        $(".revision-content").html(),
        $(".from-markdown .wiki-content")
          .html()
          .replaceAll(/<br class="ProseMirror-trailingBreak">/g, ""),
      );
      $(".previous-revision").removeClass("hide");
    } else {
      $(".revision-content")[0].innerHTML =
        `<div class="no-revision">No Revisions</div>`;
      $(".revision-time").hide();
      $(".revisions-modal .modal-header").hide();
    }

    $(".show-revisions").on("click", function () {
      frappe.call({
        method:
          "wiki.wiki.doctype.wiki_page_revision.wiki_page_revision.get_revisions",
        args: {
          wiki_page_name: $('[name="wiki-page-name"]').val(),
        },
        callback: (r) => {
          revisions = r.message;
        },
      });
    });

    function addHljsClass() {
      // to fix code blocks not having .hljs class
      // which leaves without styles from hljs
      $(".revision-content code").each(function () {
        if ($(this).parent().is("pre")) $(this).addClass("hljs");
      });
    }

    // set previous revision
    $(".previous-revision").on("click", function () {
      const currentRevision = revisions[currentRevisionIndex];
      let previousRevision = { content: "", creation: "", author: "" };

      if (revisions.length > currentRevisionIndex + 1)
        previousRevision = revisions[currentRevisionIndex + 1];

      if (!previousRevision.content) $(this).addClass("hide");
      $(".next-revision").removeClass("hide");
      if (previousRevision.content)
        $(".revision-content")[0].innerHTML = HtmlDiff.execute(
          previousRevision.content,
          currentRevision.content,
        );
      else $(".revision-content")[0].innerHTML = currentRevision.content;
      $(".revision-time")[0].innerHTML =
        `${currentRevision.author} edited ${currentRevision.revision_time}`;
      currentRevisionIndex++;
      addHljsClass();
    });

    // set next revision
    $(".next-revision").on("click", function () {
      const currentRevision = revisions[currentRevisionIndex - 2];
      let nextRevision = { content: "", creation: "", author: "" };

      if (currentRevisionIndex > 0)
        nextRevision = revisions[currentRevisionIndex - 1];

      if (currentRevisionIndex <= 2) $(this).addClass("hide");
      $(".previous-revision").removeClass("hide");
      $(".revision-content")[0].innerHTML = HtmlDiff.execute(
        nextRevision.content,
        currentRevision.content,
      );
      $(".revision-time")[0].innerHTML =
        `${currentRevision.author} edited ${currentRevision.revision_time}`;
      currentRevisionIndex--;
      addHljsClass();
    });
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
				data-name="new-sidebar" data-new=1 data-title="${title}">
				<div class="collapsible">
					<span class="text-sm">${title}</span>
          <span class='add-sidebar-page'>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </span>
          <span class='drop-icon hide'>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 10L12 14L16 10" stroke="#4C5A67" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
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

  setup_search(search_scope = "") {
    const $dropdown_menu = $("#searchModal .search-dropdown-menu");
    const searchInput = $("#searchInput");
    let dropdownItems;
    let offsetIndex = 0;

    function trimContent(content) {
      let trimmedLength = 100;
      const indexOf = content.indexOf('<b class="match">');
      if (indexOf === -1) {
        return content.slice(0, 100);
      }

      let start = indexOf - trimmedLength / 2;
      if (start < 0) {
        start = 0;
      }
      let end = indexOf + trimmedLength / 2;
      if (end > content.length) {
        end = content.length;
      }

      // fixes html tags when they are sliced
      return new DOMParser().parseFromString(
        content.slice(start, end),
        "text/html",
      ).body.innerHTML;
    }

    $(document).on("keypress", (e) => {
      if (
        $(e.target).is("textarea, input, select") ||
        $(e.target).hasClass("ProseMirror")
      )
        return;

      if (e.key === "/") {
        e.preventDefault();
        $("#searchModal").modal();
      }
    });

    $("#searchModal").on("shown.bs.modal", function () {
      searchInput.trigger("focus");
    });

    searchInput.on(
      "input",
      frappe.utils.debounce(() => {
        if (!searchInput.val() || searchInput.val().length < 2) {
          clear_dropdown();
          return;
        }

        frappe
          .call({
            method: "wiki.wiki.doctype.wiki_page.search.search",
            args: {
              query: searchInput.val(),
              path: window.location.pathname,
              space: search_scope,
            },
          })
          .then((res) => {
            let results = res.message.docs || [];
            let dropdown_html = `<div style="margin: 0.8rem;text-align: center;">No results found</div>`;
            if (results.length > 0) {
              dropdown_html = results
                .map((r) => {
                  let content = r.content;
                  if (content.startsWith("...")) content = content.slice(3);
                  if (res.message.search_engine === "redisearch")
                    content = trimContent(content);

                  return `<a class="dropdown-item" href="/${r.route}">
              <span class="result-title">${r.title}</span>
              <div class="result-text">${content}</div>
              </a>
              <div class='dropdown-border'></div>`;
                })
                .join("");
            }

            $dropdown_menu.html(dropdown_html);
            $dropdown_menu.addClass("show");
            dropdownItems = $dropdown_menu.find(".dropdown-item");
          });
      }, 100),
    );

    $("#dropdownMenuSearch, .mobile-search-icon").on("click", () => {
      $("#searchModal").modal();
    });

    searchInput.on("keydown", function (e) {
      if (e.key === "ArrowDown") navigate(0);
    });

    $dropdown_menu.on("keydown", function (e) {
      if (e.key === "ArrowUp") navigate(-1);
      else if (e.key === "ArrowDown") navigate(1);
      else if (e.key === "Escape") setTimeout(() => clear_dropdown(), 300);
    });

    // Clear dropdown when clicked
    $(window).on("click", function (e) {
      if (
        !$(e.target).is($("#searchModal")) &&
        !$("#searchModal").has(e.target).length
      ) {
        searchInput.val("");
        clear_dropdown();
      }
    });

    // Navigate the list
    var navigate = function (diff) {
      offsetIndex += diff;

      if (offsetIndex >= dropdownItems.length) offsetIndex = 0;
      if (offsetIndex < 0) offsetIndex = dropdownItems.length - 1;
      dropdownItems.eq(offsetIndex).trigger("focus");
    };

    function clear_dropdown() {
      offsetIndex = 0;
      $dropdown_menu.html("");
      $dropdown_menu.removeClass("show");
      dropdownItems = undefined;
    }

    // Remove focus state on hover
    $dropdown_menu.on("mouseover", function () {
      dropdownItems.blur();
    });
  }

  setup_feedback() {
    $(".ratings-number").on("click", function () {
      $(".submit-feedback-btn").removeClass("disabled");
      $(".ratings-number").removeClass("rating-active");
      $(this).addClass("rating-active");
    });

    $(".submit-feedback-btn").on("click", function () {
      const rating = $(".ratings-number.rating-active").val();
      const feedback = $(".long-feedback").val();
      const email = $(".feedback-email").val();
      const name = $('[name="wiki-page-name"]').val();

      const feedbackIndex = localStorage.getItem(`feedback-${name}`);

      frappe
        .call({
          method:
            "wiki.wiki.doctype.wiki_feedback.wiki_feedback.submit_feedback",
          args: {
            name,
            rating,
            feedback,
            email,
            feedback_index: feedbackIndex,
          },
        })
        .then((r) => {
          frappe.show_alert({
            message: __("Thank you for submitting your feedback!"),
            indicator: "green",
          });

          localStorage.setItem(`feedback-${name}`, r.message);

          $(".ratings-number").removeClass("rating-active");
          $(".long-feedback").val("");
          $(".feedback-email").val("");
        });
    });
  }

  setup_page_settings() {
    $(".update-page-settings-button").on("click", function () {
      const name = $('[name="wiki-page-name"]').val();
      const hideOnSidebar = $('input[name="pageHideOnSidebar"]').prop(
        "checked",
      );
      const route =
        $(".wiki-space-route-block").text().trim() +
        $('input[name="pageRoute"]').val();

      frappe
        .call({
          method: "wiki.wiki.doctype.wiki_page.wiki_page.update_page_settings",
          args: {
            name,
            settings: {
              hide_on_sidebar: !!hideOnSidebar,
              route,
            },
          },
        })
        .then(() => {
          frappe.show_alert({
            message: __("Page settings updated successfully"),
            indicator: "green",
          });

          setTimeout(() => {
            window.location.href = "/" + route;
          }, 1000);
        });
    });
  }
};
