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

        const element = $(this);
        setTimeout(function () {
          const topOffset = element.position().top;
          $(".doc-sidebar .web-sidebar")
            .get(0)
            .scrollTo(0, topOffset - 200);
        }, 50);
      }
    });
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
      this.toggle_sidebar
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
      $(".user-contributions").data("date")
    );
    $(".user-contributions").append(`last updated ${lastUpdatedDate}`);
  }

  set_darkmode_button() {
    function getDarkModeState() {
      const isUserPreferenceDarkMode = localStorage.getItem("darkMode");
      const isSystemPreferenceDarkMode = window.matchMedia?.(
        "(prefers-color-scheme: dark)"
      )?.matches;
      const darkModeState = isUserPreferenceDarkMode
        ? isUserPreferenceDarkMode == "true"
        : isSystemPreferenceDarkMode;

      return darkModeState;
    }

    function switchBanner() {
      const altSrc = $(".navbar-brand img").data("alt-src");
      const src = $(".navbar-brand img").attr("src");
      if (
        !["{{ light_mode_logo }}", "{{ dark_mode_logo }}", "None", ""].includes(
          altSrc
        )
      ) {
        $(".navbar-brand img").attr("src", altSrc);
        $(".navbar-brand img").data("alt-src", src);
      }
    }

    if (getDarkModeState()) {
      $(".sun-moon-container .feather-sun").removeClass("hide");
      $("body").addClass("dark");
      switchBanner();
    } else {
      $(".sun-moon-container .feather-moon").removeClass("hide");
      $("body").removeClass("dark");
    }

    $(".sun-moon-container").on("click", function () {
      $(".sun-moon-container .feather-sun").toggleClass("hide");
      $(".sun-moon-container .feather-moon").toggleClass("hide");
      const currentMode = getDarkModeState();
      localStorage.setItem("darkMode", !currentMode);
      switchBanner();

      $("body").toggleClass("dark");
    });
  }

  add_link_to_headings() {
    $(".from-markdown")
      .not(".revision-content")
      .find("h1, h2, h3, h4, h5, h6")
      .each((i, $heading) => {
        const text = $heading.textContent.trim();
        $heading.id = text
          .replace(/[^\u00C0-\u1FFF\u2C00-\uD7FF\w\- ]/g, "")
          .replace(/[ ]/g, "-")
          .toLowerCase();

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

  add_click_to_copy() {
    $("pre code")
      .parent("pre")
      .prepend(
        `<button title="Copy Code" class="btn copy-btn" data-toggle="tooltip"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-clipboard"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg></button>`
      );

    $(".copy-btn").on("click", function () {
      frappe.utils.copy_to_clipboard($(this).siblings("code").text());
    });
  }
};

$("#navbar-dropdown").on("click", function (e) {
  e.stopPropagation();
  $("#navbar-dropdown-content").toggleClass("hide");
});

$(document).on("click", function (e) {
  if (
    !$(e.target).closest("#navbar-dropdown, #navbar-dropdown-content").length
  ) {
    $("#navbar-dropdown-content").addClass("hide");
  }
});
