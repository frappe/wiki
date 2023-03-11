window.Wiki = class Wiki {
  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
      const active_class = "active";
      let page_href = window.location.pathname;
      if (page_href.indexOf("#") !== -1) {
        page_href = page_href.slice(0, page_href.indexOf("#"));
      }
      if ($(this).data("route") == page_href) {
        $(this).addClass(active_class);
        $(this).find("a").addClass(active_class);
      }
    });
    // scroll the active sidebar item into view
    let active_sidebar_item = $(".sidebar-item.active");
    if (active_sidebar_item.length > 0) {
      active_sidebar_item.get(1).scrollIntoView(true, {
        behavior: "smooth",
        block: "nearest",
      });
    }

    // avoid active sidebar item to be hidden under logo
    let web_sidebar = $(".web-sidebar");
    if (web_sidebar.length > 0) {
      web_sidebar.get(1).scrollBy({
        top: -100,
        behavior: "smooth",
      });
    }
  }

  toggle_sidebar(event) {
    $(event.currentTarget).parent().children("ul").toggleClass("hidden");
    event.stopPropagation();
  }

  set_active_sidebar() {
    $(".doc-sidebar,.web-sidebar").on(
      "click",
      ".collapsible",
      this.toggle_sidebar,
    );
    // $(".sidebar-group").children("ul").addClass("hidden");
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
        altSrc !== "{{ light_mode_logo }}" &&
        altSrc !== "{{ dark_mode_logo }}"
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
