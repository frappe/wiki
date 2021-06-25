window.ShowWiki = class ShowWiki {
  constructor(opts) {
    $("document").ready(() => {
      //$(`
      //	<a class='text-muted new-wiki-page' href="/{{ path }}?new=true">+ New Page</a><br>
      //	<a class='text-muted my-contributions' href="/contributions"> My Contributions</a>
      //`).appendTo($('.web-sidebar') )


      frappe
      .call("wiki.wiki.doctype.wiki_page.wiki_page.get_sidebar_for_page", {
        wiki_page: window.location.pathname.slice(1),
      })
      .then((result) => {
        $(".doc-sidebar").empty().append(result.message);

        this.activate_sidebars()
        this.set_active_sidebar();
        this.set_nav_buttons();
      
      });
      this.set_toc_highlighter();

    });
  }

  activate_sidebars() {
    $(".sidebar-item a").each(function (index) {
      const active_class = "active";
      const non_active_class = "";
      let page_href = window.location.href;
      if (page_href.indexOf("#") !== -1) {
        page_href = page_href.slice(0, page_href.indexOf("#"));
      }
      if (this.href.trim() == page_href) {
        $(this).addClass(active_class);
        $(this)
          .parent()
          .parent()
          .parent()
          .removeClass(non_active_class)
          .addClass(active_class);
      } else {
        $(this).removeClass(active_class).addClass(non_active_class);
        $(this)
          .parent()
          .parent()
          .parent()
          .removeClass(active_class)
          .addClass(non_active_class);
      }
    });
    // scroll the active sidebar item into view
    let active_sidebar_item = $(".sidebar-item a.active");
    if (active_sidebar_item.length > 0) {
      active_sidebar_item
        .parent().parent()
        .parent().parent()
        .get(0)
        .scrollIntoView(false,{
          behavior: "smooth",
          block: "nearest",
        });
    }
  }

  toggle_sidebar(event) {
    $(event.currentTarget).parent().children("ul").toggleClass("hidden");
    $(event.currentTarget).find(".drop-icon").toggleClass("hidden");
    $(event.currentTarget).find(".drop-left").toggleClass("hidden");
    event.stopPropagation();
  }

  set_active_sidebar() {
    $(".doc-sidebar,.web-sidebar").on("click", ".collapsible", this.toggle_sidebar);
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

  set_toc_highlighter() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const id = entry.target.getAttribute("id");
        if (entry.intersectionRatio > 0) {
          document
            .querySelector(`li a[href="#${id}"]`)
            .parentElement.classList.add("active");
        } else {
          document
            .querySelector(`li a[href="#${id}"]`)
            .parentElement.classList.remove("active");
        }
      });
    });

    // Track all sections that have an `id` applied
    document.querySelectorAll("h2[id], h3[id]").forEach((section) => {
      observer.observe(section);
    });
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

    if (current_index != 0) {
      $(".btn.left")[0].href =
        $(".sidebar-column").find("a")[current_index - 1].href;
      $(".btn.left")[0].innerHTML =
        "←" + $(".sidebar-column").find("a")[current_index - 1].innerHTML;
    } else {
      $(".btn.left").hide();
    }

    if (current_index < $(".sidebar-column").find("a").length - 1) {
      $(".btn.right")[0].href =
        $(".sidebar-column").find("a")[current_index + 1].href;
      $(".btn.right")[0].innerHTML =
        $(".sidebar-column").find("a")[current_index + 1].innerHTML + "→";
    } else {
      $(".btn.right").hide();
    }
  }
};
