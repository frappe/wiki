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

  set_last_updated_date() {
    const lastUpdatedDate = frappe.datetime.prettyDate(
      $(".user-contributions").data("date"),
    );
    $(".user-contributions").append(`last updated ${lastUpdatedDate}`);
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

  add_link_to_headings() {
    $(".wiki-content")
      .not(".revision-content")
      .find("h2, h3, h4, h5, h6")
      .each((i, $heading) => {
        const text = $heading.textContent.trim();
        $heading.id = text.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        let id = $heading.id;
        let $a = $('<a class="no-underline">')
          .prop("href", "#" + id)
          .attr("aria-hidden", "true").html(`
					<svg xmlns="http://www.w3.org/2000/svg" style="width: 0.8em; height: 0.8em;" viewBox="0 0 24 24" fill="none" stroke="currentColor"
						stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-link">
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
					</svg>
				`);
        $($heading).append($a);
      });
  }
};
