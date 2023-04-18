window.Wiki = class Wiki {
  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
      const active_class = "active";
      let page_href = decodeURIComponent(window.location.pathname.slice(1));
      if (page_href.indexOf("#") !== -1) {
        page_href = page_href.slice(0, page_href.indexOf("#"));
      }
      if ($(this).data("route") == page_href) {
        $(this).addClass(active_class);
        $(this).find("a").addClass(active_class);
      }
    });
    // scroll the active sidebar item into view
    let active_sidebar_item = $(".doc-sidebar .sidebar-item.active");
    if (active_sidebar_item.length > 0) {
      setTimeout(function () {
        active_sidebar_item.get(0).scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 50);
    }
  }

  toggle_sidebar(event) {
    $(event.currentTarget).parent().children("ul").toggleClass("hidden");
    $(event.currentTarget).find(".drop-icon").toggleClass("rotate");
    event.stopPropagation();
  }

  set_active_sidebar() {
    $(".doc-sidebar,.web-sidebar").on(
      "click",
      ".collapsible",
      this.toggle_sidebar,
    );

    $(".sidebar-item.active")
      .parents(" .web-sidebar .sidebar-group>ul")
      .removeClass("hidden");
  }

  scrolltotop() {
    $("html,body").animate({ scrollTop: 0 }, 0);
  }

  set_darkmode_button() {
    function switchBanner() {
      const altSrc = $(".navbar-brand img").data("alt-src");
      const src = $(".navbar-brand img").attr("src");
      if (
        !["{{ light_mode_logo }}", "{{ dark_mode_logo }}", "None"].includes(
          altSrc,
        )
      ) {
        $(".navbar-brand img").attr("src", altSrc);
        $(".navbar-brand img").data("alt-src", src);
      }
    }
    const darkMode = localStorage.getItem("darkMode");

    if (darkMode === null || darkMode === "false") {
      $(".sun-moon-container .feather-sun").removeClass("hide");
    } else {
      $(".sun-moon-container .feather-moon").removeClass("hide");
      switchBanner();
    }

    $(".sun-moon-container").on("click", function () {
      $(".sun-moon-container .feather-sun").toggleClass("hide");
      $(".sun-moon-container .feather-moon").toggleClass("hide");

      switchBanner();

      $("body").toggleClass("dark");

      localStorage.setItem("darkMode", $("body").hasClass("dark"));
    });
  }
};
